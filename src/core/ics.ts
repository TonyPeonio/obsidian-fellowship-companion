/**
 * iCalendar export of application and letters deadlines as all-day events, so they show on a
 * phone calendar that imports or subscribes to the file. CRLF line ends, 75-octet folding,
 * RFC 5545 escaping, and UIDs derived from the note path (with a `-letters` suffix for the
 * letters deadline) so re-exports update rather than duplicate.
 */

import type { FellowshipRecord } from "./board";

function escapeText(s: string): string {
	return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}

/** RFC 5545 line folding: lines longer than 75 octets continue with a leading space. */
export function foldLine(line: string): string {
	const enc = new TextEncoder();
	const out: string[] = [];
	let current = "";
	for (const ch of line) {
		if (enc.encode(current + ch).length > 75) {
			out.push(current);
			current = " " + ch;
		} else {
			current += ch;
		}
	}
	out.push(current);
	return out.join("\r\n");
}

function pad(n: number): string {
	return String(n).padStart(2, "0");
}

export function icsUtc(d: Date): string {
	return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
}

function icsDate(iso: string): string {
	return iso.replace(/-/g, "");
}

function nextDay(iso: string): string {
	const [y, m, d] = iso.split("-").map(Number);
	return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export function uidFor(path: string, kind: "deadline" | "letters" = "deadline"): string {
	const slug = path
		.replace(/\.md$/, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "");
	return `fellowship-${slug}${kind === "letters" ? "-letters" : ""}@fellowship-companion`;
}

interface IcsEvent {
	uid: string;
	date: string;
	summary: string;
	description: string;
	url: string;
}

/**
 * One VEVENT per open opportunity with an application deadline on or after `today`, and one
 * per letters deadline on or after `today` while letters are outstanding; sorted by date.
 */
export function renderIcs(records: FellowshipRecord[], today: string, now: Date): string {
	const lines: string[] = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Fellowship Companion for Obsidian//EN", "CALSCALE:GREGORIAN", "X-WR-CALNAME:Fellowship deadlines"];
	const stamp = icsUtc(now);
	const events: IcsEvent[] = [];
	for (const r of records) {
		if (!r.open) continue;
		const title = `${r.funder} — ${r.name}`;
		if (r.deadline && r.deadline >= today) events.push({ uid: uidFor(r.path), date: r.deadline, summary: `Due: ${title}`, description: `Status: ${r.status}. Note: ${r.path}`, url: r.url });
		if (r.lettersDeadline && r.lettersDeadline >= today && r.lettersTotal > 0 && r.lettersReceived < r.lettersTotal) {
			events.push({ uid: uidFor(r.path, "letters"), date: r.lettersDeadline, summary: `Letters due: ${title}`, description: `${r.lettersReceived} of ${r.lettersTotal} letters received. Note: ${r.path}`, url: r.url });
		}
	}
	events.sort((a, b) => a.date.localeCompare(b.date) || a.summary.localeCompare(b.summary));
	for (const e of events) {
		lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp}`, `DTSTART;VALUE=DATE:${icsDate(e.date)}`, `DTEND;VALUE=DATE:${icsDate(nextDay(e.date))}`, `SUMMARY:${escapeText(e.summary)}`, `DESCRIPTION:${escapeText(e.description)}`);
		if (e.url) lines.push(`URL:${e.url}`);
		lines.push("END:VEVENT");
	}
	lines.push("END:VCALENDAR");
	return lines.map(foldLine).join("\r\n") + "\r\n";
}
