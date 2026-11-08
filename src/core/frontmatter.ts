/**
 * The small YAML subset the fellowship note uses: `key: value` scalars and `key:` followed by
 * `- item` lines (or `key: []`). Values are kept as strings; the note code knows the types.
 */

export type FrontmatterValue = string | string[];

export interface Frontmatter {
	data: Record<string, FrontmatterValue>;
	/** Note text after the frontmatter block. */
	body: string;
	/** True when the note had a frontmatter block. */
	present: boolean;
}

export function parseFrontmatter(content: string): Frontmatter {
	const m = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
	if (!m) return { data: {}, body: content, present: false };
	const data: Record<string, FrontmatterValue> = {};
	let listKey: string | null = null;
	for (const raw of m[1].split(/\r?\n/)) {
		const item = /^\s*-\s*(.*)$/.exec(raw);
		if (item && listKey) {
			(data[listKey] as string[]).push(unquote(item[1]));
			continue;
		}
		const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(raw);
		if (!kv) continue;
		const [, key, value] = kv;
		if (value === "" || value === "[]") {
			data[key] = [];
			listKey = value === "" ? key : null;
		} else if (value.startsWith("[") && value.endsWith("]")) {
			data[key] = value
				.slice(1, -1)
				.split(",")
				.map((s) => unquote(s.trim()))
				.filter(Boolean);
			listKey = null;
		} else {
			data[key] = unquote(value);
			listKey = null;
		}
	}
	return { data, body: content.slice(m[0].length), present: true };
}

export function renderFrontmatter(data: Record<string, FrontmatterValue>): string {
	const lines = ["---"];
	for (const [key, value] of Object.entries(data)) {
		if (Array.isArray(value)) {
			if (value.length === 0) lines.push(`${key}: []`);
			else {
				lines.push(`${key}:`);
				for (const v of value) lines.push(`  - ${quote(v)}`);
			}
		} else {
			lines.push(`${key}: ${quote(value)}`);
		}
	}
	lines.push("---");
	return lines.join("\n") + "\n";
}

function unquote(s: string): string {
	const t = s.trim();
	if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) return t.slice(1, -1).replace(/\\"/g, '"');
	return t;
}

/** Quotes when YAML would otherwise misread the value (colons, leading symbols, brackets). */
function quote(s: string): string {
	if (s === "") return '""';
	if (/^[\d.-]+$/.test(s) && !/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
	if (/[:#[\]{}"'|>&*!%@`,]/.test(s) || /^\s|\s$/.test(s) || /^(true|false|null|yes|no)$/i.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
	return s;
}

/**
 * Sets one scalar key in place, keeping every other line (and the user's ordering) as is.
 * A missing key is added before the closing `---`; a note without frontmatter gets one.
 */
export function setFrontmatterValue(content: string, key: string, value: string): string {
	const m = /^---\r?\n([\s\S]*?)\r?\n---(\r?\n|$)/.exec(content);
	const line = `${key}: ${quote(value)}`;
	if (!m) return `---\n${line}\n---\n${content}`;
	const lines = m[1].split(/\r?\n/);
	const keyRe = new RegExp(`^${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}:`);
	const idx = lines.findIndex((l) => keyRe.test(l));
	if (idx >= 0) {
		// Drop list items that belonged to the old value, if it was a list.
		let end = idx + 1;
		while (end < lines.length && /^\s+-\s/.test(lines[end])) end++;
		lines.splice(idx, end - idx, line);
	} else {
		lines.push(line);
	}
	return `---\n${lines.join("\n")}\n---${m[2]}${content.slice(m[0].length)}`;
}
