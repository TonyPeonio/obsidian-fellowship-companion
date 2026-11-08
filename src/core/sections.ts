/**
 * `## Heading` sections of a note body, read and rewritten without touching anything else.
 * Fenced code blocks are opaque: a `## ` line inside one (the pasted call lives in a fence)
 * is not a heading.
 */

export interface Section {
	heading: string;
	/** Index of the heading line in the split lines. */
	start: number;
	/** Index one past the last line of the section. */
	end: number;
}

export function splitLines(content: string): string[] {
	return content.split(/\r?\n/);
}

/** Top-level (`## `) sections of `lines`, fence-aware. */
export function findSections(lines: string[]): Section[] {
	const out: Section[] = [];
	let fence: string | null = null;
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];
		const f = /^(\s*)(`{3,}|~{3,})/.exec(line);
		if (f) {
			if (!fence) fence = f[2];
			else if (f[2][0] === fence[0] && f[2].length >= fence.length) fence = null;
			continue;
		}
		if (fence) continue;
		const h = /^## (.+?)\s*$/.exec(line);
		if (!h) continue;
		if (out.length) out[out.length - 1].end = i;
		out.push({ heading: h[1], start: i, end: lines.length });
	}
	return out;
}

/** The body text of `## heading` (without the heading line), or null when absent. */
export function sectionBody(content: string, heading: string): string | null {
	const lines = splitLines(content);
	const s = findSections(lines).find((x) => x.heading.toLowerCase() === heading.toLowerCase());
	return s ? lines.slice(s.start + 1, s.end).join("\n").trim() : null;
}

/** Replaces the body of `## heading`, or appends the section when the note has none. */
export function upsertSection(content: string, heading: string, body: string): string {
	const lines = splitLines(content);
	const sections = findSections(lines);
	const idx = sections.findIndex((x) => x.heading.toLowerCase() === heading.toLowerCase());
	const block = [`## ${heading}`, "", body.trim(), ""];
	if (idx < 0) {
		const trimmed = content.replace(/\s+$/, "");
		return `${trimmed}\n\n${block.join("\n")}`;
	}
	const s = sections[idx];
	const after = lines.slice(s.end);
	const before = lines.slice(0, s.start);
	return [...before, ...block, ...(after.length && after[0].trim() !== "" ? [""] : []), ...after].join("\n").replace(/\n{3,}/g, "\n\n");
}

/** Appends `line` to the end of `## heading`'s list (creating the section at the end when missing). */
export function appendToSection(content: string, heading: string, line: string): string {
	const lines = splitLines(content);
	const s = findSections(lines).find((x) => x.heading.toLowerCase() === heading.toLowerCase());
	if (!s) return upsertSection(content, heading, line);
	let insertAt = s.end;
	while (insertAt > s.start + 1 && lines[insertAt - 1].trim() === "") insertAt--;
	const needsBlank = insertAt === s.start + 1;
	lines.splice(insertAt, 0, ...(needsBlank ? ["", line] : [line]));
	return lines.join("\n");
}

/** `- item` / `* item` / `1. item` lines of a section body, with the marker removed. */
export function listItems(body: string | null): string[] {
	if (!body) return [];
	const out: string[] = [];
	for (const raw of body.split(/\r?\n/)) {
		const m = /^\s*(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?(.+?)\s*$/.exec(raw);
		if (m) out.push(m[1]);
	}
	return out;
}
