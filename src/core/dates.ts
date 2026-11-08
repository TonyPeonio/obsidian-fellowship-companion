/** Calendar dates as `YYYY-MM-DD` strings, handled in UTC so DST never shifts a day. */

const DAY_MS = 86_400_000;
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function isIsoDate(s: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

function toMs(date: string): number {
	const [y, m, d] = date.split("-").map(Number);
	return Date.UTC(y, m - 1, d);
}

function fromMs(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(date: string, n: number): string {
	return fromMs(toMs(date) + n * DAY_MS);
}

/** Whole days from `a` to `b` (positive when `b` is later). */
export function daysBetween(a: string, b: string): number {
	return Math.round((toMs(b) - toMs(a)) / DAY_MS);
}

export function weekday(date: string): string {
	return WEEKDAYS[new Date(toMs(date)).getUTCDay()];
}

/** Today's local calendar date. */
export function today(now: Date = new Date()): string {
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, "0");
	const d = String(now.getDate()).padStart(2, "0");
	return `${y}-${m}-${d}`;
}

/** Every date from `start` to `end` inclusive, in order. Empty when `end` is before `start`. */
export function dateRange(start: string, end: string): string[] {
	const n = daysBetween(start, end);
	if (n < 0) return [];
	return Array.from({ length: n + 1 }, (_, i) => addDays(start, i));
}

// ---------------------------------------------------------------- human-written dates

const MONTHS: Record<string, number> = {
	jan: 1, january: 1, feb: 2, february: 2, mar: 3, march: 3, apr: 4, april: 4, may: 5, jun: 6, june: 6,
	jul: 7, july: 7, aug: 8, august: 8, sep: 9, sept: 9, september: 9, oct: 10, october: 10, nov: 11, november: 11, dec: 12, december: 12,
};
const MONTH_NAME = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const ORDINAL = "(?:st|nd|rd|th)?";

export interface FoundDate {
	/** `YYYY-MM-DD`. */
	iso: string;
	/** Offset of the match in the searched text. */
	index: number;
	/** The text as written. */
	raw: string;
	/** True when the text carried no year and the next occurrence on or after `today` was assumed. */
	yearAssumed: boolean;
}

function valid(y: number, m: number, d: number): string | null {
	if (y < 2000 || y > 2100 || m < 1 || m > 12 || d < 1 || d > 31) return null;
	const ms = Date.UTC(y, m - 1, d);
	const dt = new Date(ms);
	if (dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
	return fromMs(ms);
}

/** A month and day without a year: the next occurrence on or after `today`. */
function assumeYear(m: number, d: number, todayIso: string): string | null {
	const y = Number(todayIso.slice(0, 4));
	const thisYear = valid(y, m, d);
	if (thisYear && thisYear >= todayIso) return thisYear;
	return valid(y + 1, m, d);
}

function fullYear(s: string): number {
	return s.length === 2 ? 2000 + Number(s) : Number(s);
}

/**
 * Every date written in `text`, in order: `2026-11-30`, `11/30/2026` (month first; day first
 * when the first number cannot be a month), `Nov 30`, `November 30, 2026`, `30 November 2026`,
 * `30th Nov`. Month-day without a year takes the next occurrence on or after `today`.
 * Vague phrases ("end of month", "ASAP", "rolling") are not dates and are not matched.
 */
export function findDates(text: string, todayIso: string): FoundDate[] {
	const out: FoundDate[] = [];
	const push = (iso: string | null, index: number, raw: string, yearAssumed: boolean) => {
		if (iso) out.push({ iso, index, raw, yearAssumed });
	};
	for (const m of text.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)) push(valid(Number(m[1]), Number(m[2]), Number(m[3])), m.index, m[0], false);
	for (const m of text.matchAll(/\b(\d{1,2})[/.](\d{1,2})[/.](\d{4}|\d{2})\b/g)) {
		const a = Number(m[1]);
		const b = Number(m[2]);
		const y = fullYear(m[3]);
		push(a > 12 ? valid(y, b, a) : valid(y, a, b), m.index, m[0], false);
	}
	const monthFirst = new RegExp(`\\b${MONTH_NAME}\\.?\\s+(\\d{1,2})${ORDINAL}\\b(?:,?\\s+(\\d{4})\\b)?`, "gi");
	for (const m of text.matchAll(monthFirst)) {
		const month = MONTHS[m[1].toLowerCase()];
		const day = Number(m[2]);
		if (m[3]) push(valid(Number(m[3]), month, day), m.index, m[0], false);
		else push(assumeYear(month, day, todayIso), m.index, m[0], true);
	}
	const dayFirst = new RegExp(`\\b(\\d{1,2})${ORDINAL}\\s+(?:of\\s+)?${MONTH_NAME}\\.?\\b(?:,?\\s+(\\d{4})\\b)?`, "gi");
	for (const m of text.matchAll(dayFirst)) {
		const day = Number(m[1]);
		const month = MONTHS[m[2].toLowerCase()];
		if (m[3]) push(valid(Number(m[3]), month, day), m.index, m[0], false);
		else push(assumeYear(month, day, todayIso), m.index, m[0], true);
	}
	// Drop matches that sit inside an earlier, longer match (e.g. "30" of "November 30, 2026").
	out.sort((a, b) => a.index - b.index || b.raw.length - a.raw.length);
	const kept: FoundDate[] = [];
	for (const d of out) {
		const last = kept[kept.length - 1];
		if (last && d.index < last.index + last.raw.length) continue;
		kept.push(d);
	}
	return kept;
}

/** The first date in `text` as `YYYY-MM-DD`, or null when there is none it can read. */
export function parseDateText(text: string | null | undefined, todayIso: string): string | null {
	if (!text) return null;
	const t = text.trim();
	if (isIsoDate(t)) return t;
	return findDates(t, todayIso)[0]?.iso ?? null;
}
