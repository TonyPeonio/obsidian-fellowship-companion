/**
 * The fellowship note: frontmatter + fixed sections. Rendering is deterministic; parsing reads
 * back what the plugin (or the user, within reason) wrote, including the Letters table.
 */

import type { CallFields } from "./call";
import { isIsoDate } from "./dates";
import { parseFrontmatter, renderFrontmatter, type FrontmatterValue } from "./frontmatter";
import { materialsProgress, type MaterialsChecklist } from "./materials";
import { findSections, listItems, sectionBody, splitLines } from "./sections";
import { STATUSES, type Status } from "./status";

export interface FellowshipNoteInput extends CallFields {
	url: string;
	callText: string;
	/** `YYYY-MM-DD` the note is created. */
	today: string;
}

export interface LetterRow {
	recommender: string;
	/** `YYYY-MM-DD` or "" */
	askedOn: string;
	/** `YYYY-MM-DD` or "" */
	receivedOn: string;
}

export interface FellowshipNote {
	name: string;
	funder: string;
	amount: string;
	deadline: string | null;
	lettersDeadline: string | null;
	status: Status;
	submittedOn: string;
	eligibility: string[];
	materials: string[];
	url: string;
	keywords: string[];
	letters: LetterRow[];
	materialsChecklist: MaterialsChecklist;
	/** The call text as pasted (from the fence under `## Call`), "" when absent. */
	callText: string;
	timeline: { date: string; text: string }[];
}

/** `Funder - Name` with characters Obsidian cannot put in a file name removed. */
export function fellowshipFileName(funder: string, name: string): string {
	return `${cleanFileName(funder) || "Unknown funder"} - ${cleanFileName(name) || "Untitled opportunity"}.md`;
}

export function cleanFileName(s: string): string {
	return s
		.replace(/[\\/:*?"<>|#^[\]]/g, "")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 120);
}

/** A fence long enough that the pasted text cannot close it early. */
function fenceFor(text: string): string {
	let longest = 2;
	for (const m of text.matchAll(/`{3,}/g)) longest = Math.max(longest, m[0].length);
	return "`".repeat(longest + 1);
}

export const LETTERS_HEADER = ["| Recommender | Asked on | Received on |", "|---|---|---|"];

export function renderLettersTable(rows: LetterRow[]): string {
	return [...LETTERS_HEADER, ...rows.map((r) => `| ${cell(r.recommender)} | ${r.askedOn} | ${r.receivedOn} |`)].join("\n");
}

function cell(s: string): string {
	return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

export function renderFellowshipNote(p: FellowshipNoteInput): string {
	const fm: Record<string, FrontmatterValue> = {
		name: p.name,
		funder: p.funder,
		amount: p.amount,
		deadline: p.deadline ?? "",
		letters_deadline: p.lettersDeadline ?? "",
		status: "considering",
		submitted_on: "",
		eligibility: p.eligibility,
		materials: p.materials,
		url: p.url,
		keywords: p.keywords,
		source: "fellowship",
	};
	const fence = fenceFor(p.callText);
	const checklist = (items: string[], empty: string) => (items.length ? items.map((i) => `- ${i}`).join("\n") : `_${empty}_`);
	const letterRows: LetterRow[] = Array.from({ length: p.lettersCount }, () => ({ recommender: "", askedOn: "", receivedOn: "" }));
	const facts = [p.amount ? `**Amount:** ${p.amount}` : null, p.deadline ? `**Deadline:** ${p.deadline}` : "**Deadline:** not found in the call", p.lettersDeadline ? `**Letters deadline:** ${p.lettersDeadline}` : null, p.url ? `**URL:** ${p.url}` : null].filter((x): x is string => x !== null);
	return [
		renderFrontmatter(fm),
		`# ${p.funder} — ${p.name}`,
		"",
		facts.join("  \n"),
		"",
		"## Call",
		"",
		`${fence}text`,
		p.callText.replace(/\s+$/, ""),
		fence,
		"",
		"## Eligibility",
		"",
		checklist(p.eligibility, "No eligibility statements found. Add them as `- ` bullets; Screen eligibility reads this list and the properties."),
		"",
		"## Materials",
		"",
		checklist(p.materials, "No required materials found. Add them under `materials:` in the properties and run Check materials."),
		"",
		"## Letters",
		"",
		renderLettersTable(letterRows),
		"",
		p.lettersCount > 0 ? `_${p.lettersCount} letter${p.lettersCount === 1 ? "" : "s"} requested. Fill in a recommender per row; Draft letter requests writes a request note for each named row without an "asked on" date and fills that date in._` : "_No letters mentioned in the call. Add a row per recommender if you need them._",
		"",
		"## Timeline",
		"",
		`- ${p.today} — added`,
		"",
		"## Notes",
		"",
		"",
	]
		.join("\n")
		.replace(/\n{3,}/g, "\n\n");
}

function scalar(v: FrontmatterValue | undefined): string {
	return Array.isArray(v) ? v.join(", ") : (v ?? "");
}

function list(v: FrontmatterValue | undefined): string[] {
	if (Array.isArray(v)) return v.filter(Boolean);
	const s = scalar(v);
	return s ? [s] : [];
}

/** True when a note's frontmatter marks it as one of ours. */
export function isFellowshipNote(data: Record<string, FrontmatterValue>): boolean {
	return typeof data.name === "string" && typeof data.funder === "string" && typeof data.status === "string";
}

export function parseFellowshipNote(content: string): FellowshipNote | null {
	const fm = parseFrontmatter(content);
	if (!fm.present || !isFellowshipNote(fm.data)) return null;
	const d = fm.data;
	const statusRaw = scalar(d.status).toLowerCase();
	const deadline = scalar(d.deadline);
	const lettersDeadline = scalar(d.letters_deadline);
	return {
		name: scalar(d.name),
		funder: scalar(d.funder),
		amount: scalar(d.amount),
		deadline: isIsoDate(deadline) ? deadline : null,
		lettersDeadline: isIsoDate(lettersDeadline) ? lettersDeadline : null,
		status: (STATUSES as readonly string[]).includes(statusRaw) ? (statusRaw as Status) : "considering",
		submittedOn: scalar(d.submitted_on),
		eligibility: list(d.eligibility),
		materials: list(d.materials),
		url: scalar(d.url),
		keywords: list(d.keywords),
		letters: parseLettersTable(content),
		materialsChecklist: materialsProgress(sectionBody(content, "Materials")),
		callText: parseCallText(content),
		timeline: parseTimeline(content),
	};
}

/** The text inside the first fence under `## Call`, or "" when there is none. */
export function parseCallText(content: string): string {
	const body = sectionBody(content, "Call");
	if (!body) return "";
	const m = /^(`{3,}|~{3,})[^\n]*\n([\s\S]*?)\n\1\s*$/m.exec(body);
	return m ? m[2] : body;
}

/** Table rows under `## Letters`: header and separator skipped, empty recommender rows kept (they count as requested letters). */
export function parseLettersTable(content: string): LetterRow[] {
	const body = sectionBody(content, "Letters");
	if (!body) return [];
	const out: LetterRow[] = [];
	for (const raw of body.split(/\r?\n/)) {
		const row = parseTableRow(raw);
		if (!row) continue;
		if (/^recommender$/i.test(row[0]) || /^:?-{2,}:?$/.test(row[0])) continue;
		out.push({ recommender: row[0] ?? "", askedOn: (row[1] ?? "").trim(), receivedOn: (row[2] ?? "").trim() });
	}
	return out;
}

function parseTableRow(line: string): string[] | null {
	const t = line.trim();
	if (!t.startsWith("|")) return null;
	const inner = t.slice(1, t.endsWith("|") ? -1 : undefined);
	// Split on unescaped pipes (`\|` stays part of the cell); no lookbehind, for older iOS.
	const cells: string[] = [];
	let current = "";
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (ch === "\\" && inner[i + 1] === "|") {
			current += "|";
			i++;
		} else if (ch === "|") {
			cells.push(current.trim());
			current = "";
		} else {
			current += ch;
		}
	}
	cells.push(current.trim());
	return cells;
}

/** Rows with a recommender name (the ones letter requests and the board count). */
export function namedLetters(rows: LetterRow[]): LetterRow[] {
	return rows.filter((r) => r.recommender.trim() !== "");
}

/**
 * Rewrites one cell of the Letters table in place (`askedOn` or `receivedOn`) for the row whose
 * recommender matches, leaving every other line of the note untouched. Returns the content
 * unchanged when the row is not found.
 */
export function setLetterDate(content: string, recommender: string, field: "askedOn" | "receivedOn", date: string): string {
	const lines = splitLines(content);
	const section = findSections(lines).find((s) => s.heading.toLowerCase() === "letters");
	if (!section) return content;
	for (let i = section.start + 1; i < section.end; i++) {
		const row = parseTableRow(lines[i]);
		if (!row || row[0].toLowerCase() !== recommender.trim().toLowerCase()) continue;
		const r: LetterRow = { recommender: row[0], askedOn: row[1] ?? "", receivedOn: row[2] ?? "" };
		r[field] = date;
		lines[i] = `| ${cell(r.recommender)} | ${r.askedOn} | ${r.receivedOn} |`;
		return lines.join("\n");
	}
	return content;
}

export function parseTimeline(content: string): { date: string; text: string }[] {
	const out: { date: string; text: string }[] = [];
	for (const item of listItems(sectionBody(content, "Timeline"))) {
		const m = /^(\d{4}-\d{2}-\d{2})\s*[—–-]+\s*(.*)$/.exec(item);
		if (m) out.push({ date: m[1], text: m[2] });
	}
	return out;
}

/** The latest Timeline date, or null when the note has no dated line. */
export function lastUpdate(note: FellowshipNote): string | null {
	let last: string | null = null;
	for (const t of note.timeline) if (!last || t.date > last) last = t.date;
	return last;
}
