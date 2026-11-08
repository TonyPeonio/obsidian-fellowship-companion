/**
 * The board: one managed note summarising every fellowship note by status, with what is due
 * soon and whose letters are due at the top. Pure function of the records and `today`.
 */

import { daysBetween } from "./dates";
import { lettersCount, materialCategory } from "./materials";
import { lastUpdate, namedLetters, parseFellowshipNote } from "./note";
import { ACTIVE_STATUSES, OPEN_STATUSES, STATUSES, type Status } from "./status";
import { notesInFolder, type VaultAccess } from "./vault";

export interface FellowshipRecord {
	/** Vault path of the note, with `.md`. */
	path: string;
	name: string;
	funder: string;
	status: Status;
	amount: string;
	deadline: string | null;
	lettersDeadline: string | null;
	/** Letters received / letters expected (named rows, or the count the call asked for). */
	lettersReceived: number;
	lettersTotal: number;
	/** Ticked / total items under `## Materials`. */
	materialsReady: number;
	materialsTotal: number;
	/** `YYYY-MM-DD` of the last Timeline line (or the file's mtime when the Timeline has none). */
	lastUpdate: string;
	url: string;
	/** Not yet submitted: considering or preparing. */
	open: boolean;
	active: boolean;
}

export const DUE_WINDOW_DAYS = 30;
export const LETTERS_WINDOW_DAYS = 14;
export const BOARD_FILE = "Board.md";

/** Reads every fellowship note under `folder` (Board.md, letter requests and foreign notes are skipped). */
export async function loadFellowships(vault: VaultAccess, folder: string): Promise<FellowshipRecord[]> {
	const out: FellowshipRecord[] = [];
	for (const n of notesInFolder(vault, folder)) {
		if (n.basename === BOARD_FILE.replace(/\.md$/, "")) continue;
		const note = parseFellowshipNote(await vault.read(n.path));
		if (!note) continue;
		const named = namedLetters(note.letters);
		const asked = note.materials.map(lettersCount).find((c): c is number => c !== null) ?? 0;
		const lettersTotal = Math.max(named.length, asked, note.letters.length);
		out.push({
			path: n.path,
			name: note.name,
			funder: note.funder,
			status: note.status,
			amount: note.amount,
			deadline: note.deadline,
			lettersDeadline: note.lettersDeadline,
			lettersReceived: named.filter((r) => r.receivedOn !== "").length,
			lettersTotal,
			materialsReady: note.materialsChecklist.ready,
			materialsTotal: note.materialsChecklist.total,
			lastUpdate: lastUpdate(note) ?? new Date(n.mtime).toISOString().slice(0, 10),
			url: note.url,
			open: OPEN_STATUSES.includes(note.status),
			active: ACTIVE_STATUSES.includes(note.status),
		});
	}
	return out;
}

/** True when the record's materials list asks for letters at all. */
export function wantsLetters(r: FellowshipRecord): boolean {
	return r.lettersTotal > 0;
}

function cell(s: string): string {
	return s.replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
}

function link(r: FellowshipRecord, text: string, inTable: boolean): string {
	const target = r.path.replace(/\.md$/, "");
	return inTable ? `[[${target}\\|${cell(text)}]]` : `[[${target}|${text}]]`;
}

export function daysLeftText(deadline: string | null, today: string): string {
	if (!deadline) return "";
	const n = daysBetween(today, deadline);
	if (n < 0) return `overdue (${-n}d)`;
	if (n === 0) return "today";
	return String(n);
}

function byDeadline(a: FellowshipRecord, b: FellowshipRecord): number {
	if (a.deadline && b.deadline && a.deadline !== b.deadline) return a.deadline.localeCompare(b.deadline);
	if (a.deadline && !b.deadline) return -1;
	if (!a.deadline && b.deadline) return 1;
	return a.funder.localeCompare(b.funder) || a.name.localeCompare(b.name);
}

/** Open opportunities whose application deadline falls within the next `DUE_WINDOW_DAYS` days (today included). */
export function dueSoon(records: FellowshipRecord[], today: string): FellowshipRecord[] {
	return records.filter((r) => r.open && r.deadline && r.deadline >= today && daysBetween(today, r.deadline) <= DUE_WINDOW_DAYS).sort(byDeadline);
}

/**
 * Open opportunities with letters still outstanding whose letters deadline (or, when the call
 * states none, the application deadline) falls within the next `LETTERS_WINDOW_DAYS` days.
 */
export function lettersDueSoon(records: FellowshipRecord[], today: string): FellowshipRecord[] {
	return records
		.filter((r) => {
			if (!r.open || !wantsLetters(r) || r.lettersReceived >= r.lettersTotal) return false;
			const due = r.lettersDeadline ?? r.deadline;
			return due !== null && due >= today && daysBetween(today, due) <= LETTERS_WINDOW_DAYS;
		})
		.sort((a, b) => (a.lettersDeadline ?? a.deadline ?? "").localeCompare(b.lettersDeadline ?? b.deadline ?? "") || byDeadline(a, b));
}

export function lettersText(r: FellowshipRecord): string {
	if (!wantsLetters(r)) return "";
	return `${r.lettersReceived} of ${r.lettersTotal} received`;
}

export function materialsText(r: FellowshipRecord): string {
	if (r.materialsTotal === 0) return "";
	return `${r.materialsReady} of ${r.materialsTotal} ready`;
}

function titleCase(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}

export function renderBoard(records: FellowshipRecord[], today: string): string {
	const lines: string[] = [
		"---",
		"source: board",
		"---",
		"# Board",
		"",
		`_Refreshed ${today} by Fellowship Companion from ${records.length} fellowship note${records.length === 1 ? "" : "s"}. Run "Open the board" to refresh; edits here are overwritten._`,
		"",
		`## Due in ${DUE_WINDOW_DAYS} days`,
		"",
	];
	const due = dueSoon(records, today);
	if (due.length === 0) lines.push("_Nothing due._");
	for (const r of due) {
		const extras = [lettersText(r), materialsText(r)].filter(Boolean);
		lines.push(`- ${r.deadline} (${daysLeftText(r.deadline, today)}) — ${link(r, `${r.funder} — ${r.name}`, false)} · ${r.status}${extras.length ? ` · ${extras.join(" · ")}` : ""}`);
	}
	lines.push("", `## Letters due in ${LETTERS_WINDOW_DAYS} days`, "");
	const letters = lettersDueSoon(records, today);
	if (letters.length === 0) lines.push("_No letters due._");
	for (const r of letters) {
		const due = r.lettersDeadline ?? r.deadline!;
		lines.push(`- ${due} (${daysLeftText(due, today)}) — ${link(r, `${r.funder} — ${r.name}`, false)} · ${lettersText(r)}${r.lettersDeadline ? "" : " · application deadline (no separate letters date)"}`);
	}
	for (const status of STATUSES) {
		const rows = records.filter((r) => r.status === status).sort(byDeadline);
		lines.push("", `## ${titleCase(status)} (${rows.length})`, "");
		if (rows.length === 0) {
			lines.push("_None._");
			continue;
		}
		lines.push("| Funder | Name | Deadline | Days left | Letters | Materials | Note |", "|---|---|---|---|---|---|---|");
		for (const r of rows) lines.push(`| ${cell(r.funder)} | ${cell(r.name)} | ${r.deadline ?? ""} | ${daysLeftText(r.deadline, today)} | ${lettersText(r)} | ${materialsText(r)} | ${link(r, "open", true)} |`);
	}
	lines.push("");
	return lines.join("\n");
}

/** Whether a material line in the note's list is the letters entry (used by the materials check to pair with the table). */
export function isLettersMaterial(material: string): boolean {
	return materialCategory(material) === "letters";
}
