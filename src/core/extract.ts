/**
 * Deterministic first pass over a pasted call for applications. Everything here is a regex
 * over the text; the local model only fills what this pass leaves empty, and loses to it on
 * conflict (see `call.ts`).
 */

import { findDates } from "./dates";
import { CATEGORY_LABELS, lettersCount, materialCategory, type MaterialCategory } from "./materials";

export interface RegexExtraction {
	/** First non-empty line, trimmed: a guess at the opportunity's name used only when nothing better exists. */
	titleGuess: string | null;
	/** From a `Program:` / `Fellowship:` / `Award:` label line only. */
	name: string | null;
	/** From a `Funder:` / `Sponsor:` label line or "offered by the …" wording. */
	funder: string | null;
	/** The money as written, e.g. `$38,000 per year`, `€1,500/month`, `up to £2,000`. */
	amount: string | null;
	/** `YYYY-MM-DD` application deadline; null when none or only vague wording. */
	deadline: string | null;
	/** `YYYY-MM-DD` deadline for letters of recommendation when the call states one separately. */
	lettersDeadline: string | null;
	/** Sentences that state who may apply (citizenship, degree level, year, field, GPA). */
	eligibility: string[];
	/** Required materials as canonical labels (`CV`, `Transcript`, `3 letters of recommendation`, …) plus verbatim extras. */
	materials: string[];
	/** Number of letters requested, when written. */
	lettersCount: number | null;
	/** The first URL in the text, if any. */
	url: string | null;
}

const STRICT_DEADLINE = /\b(deadline|due|apply by|applications? (?:close|closes|closing|are due|must be (?:received|submitted|postmarked))|closing date|closes?|submit(?:ted)? (?:by|no later than)|no later than|last day to apply|must be (?:received|submitted|uploaded|postmarked)|received by|postmarked by)\b/i;
const WEAK_DEADLINE = /\bby\b/i;
const LETTER_WORDS = /\b(letters?|recommend(?:ation|ations|ers?)|referees?|references?)\b/i;
const NOT_A_DEADLINE = /\b(notif(?:y|ied|ication)|announce[ds]?|awards? (?:will be )?(?:made|announced)|begins?|starts?|commence|posted|published|tenure|fellowship (?:year|period)|opens?)\b/i;

const CURRENCY_SYMBOL = "(?:US\\$|CA\\$|A\\$|NZ\\$|[$£€])";
const AMOUNT = "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?|\\d+(?:\\.\\d+)?\\s?[kK]\\b|\\d{3,7}(?:\\.\\d+)?";
const RANGE_SEP = "\\s?(?:-|–|—|to)\\s?";
const PERIOD = "(?:\\s?(?:per|/|a|an|each)\\s?(?:academic\\s+year|calendar\\s+year|year|yr|annum|month|mo|semester|term|quarter|week|wk)\\b|\\s(?:annually|monthly|per\\s+annum)\\b)?";
const QUALIFIER = "(?:(?:up\\s+to|maximum\\s+of)\\s+)?";
const AMOUNT_SYMBOL = new RegExp(`${QUALIFIER}${CURRENCY_SYMBOL}\\s?(?:${AMOUNT})(?:${RANGE_SEP}${CURRENCY_SYMBOL}?\\s?(?:${AMOUNT}))?${PERIOD}`, "gi");
const AMOUNT_CODE = new RegExp(`${QUALIFIER}(?:(?:USD|GBP|EUR|CAD|AUD|CHF|NZD)\\s?(?:${AMOUNT})|(?:${AMOUNT})\\s?(?:USD|GBP|EUR|CAD|AUD|CHF|NZD)\\b)${PERIOD}`, "gi");

const ELIGIBILITY_HEADING = /^(?:#+\s*)?(?:\*\*)?\s*(?:eligibility(?:\s+(?:criteria|requirements))?|who (?:can|may|should|is eligible to) apply|eligible applicants|applicant eligibility)\s*(?:\*\*)?\s*:?\s*$/i;
const MATERIALS_HEADING = /^(?:#+\s*)?(?:\*\*)?\s*(?:(?:required|application) (?:materials|documents|components|package)|materials|what to submit|how to apply|application (?:requirements|checklist)|to apply|your application (?:must|should) include|submission requirements)\s*(?:\*\*)?\s*:?\s*$/i;
const NEGATED = /\b(?:no|not|without|neither|nor|instead of|do not|does not|optional)\b/i;
const HEADING_LIKE =/^(?:#+\s+.+|(?:\*\*)?[A-Z][A-Za-z0-9 /&'()-]{1,50}(?:\*\*)?:?)$/;

const STRONG_ELIGIBILITY = /\b(must be|applicants? must|candidates? must|must have|must hold|eligible|eligibility|citizens?|citizenship|permanent residents?|enrolled|GPA|grade point average|pursuing|in good standing|open to|restricted to|limited to|under the age|years of age|at the time of application|nationals?)\b/i;
const ELIGIBILITY_TOPIC = /\b(citizens?|citizenship|residents?|nationals?|nationality|enrolled|enrol(?:l)?ment|GPA|grade point|degree|undergraduates?|graduates?|doctoral|Ph\.?D|master'?s?|bachelor'?s?|students?|freshman|freshmen|sophomores?|juniors?|seniors?|years?|fields?|majors?|disciplines?|STEM|age|institutions?|universit(?:y|ies)|colleges?|standing)\b/i;

export function extractCall(text: string, todayIso: string): RegexExtraction {
	const lines = text.split(/\r?\n/).map((l) => l.trim());
	const nonEmpty = lines.filter(Boolean);
	const titleGuess = nonEmpty.length && nonEmpty[0].length <= 140 ? stripCallPrefix(stripMarkdown(nonEmpty[0])) : null;
	const sentences = splitSentences(text);
	const { deadline, lettersDeadline } = extractDeadlines(sentences, todayIso);
	const materials = extractMaterials(lines, sentences);
	return {
		titleGuess,
		name: labelValue(lines, /^(?:program|programme|fellowship|award|grant|scholarship|opportunity|title)(?:\s+name)?\s*[:：]\s*(.+)$/i),
		funder: extractFunder(lines, sentences),
		amount: extractAmount(sentences),
		deadline,
		lettersDeadline,
		eligibility: extractEligibility(lines, sentences),
		materials,
		lettersCount: materials.map(lettersCount).find((n): n is number => n !== null) ?? null,
		url: /https?:\/\/[^\s)>\]"']+/i.exec(text)?.[0] ?? null,
	};
}

/** "Call for applications: X" → "X". */
export function stripCallPrefix(s: string): string {
	return s.replace(/^(?:call for (?:applications|proposals|nominations|papers)|request for (?:applications|proposals)|funding opportunity|announcement)\s*[:：-]\s*/i, "").trim() || s;
}

export function stripMarkdown(s: string): string {
	return s
		.replace(/^#+\s*/, "")
		.replace(/\*\*|__/g, "")
		.replace(/^\s*(?:[-*+•]|\d+[.)])\s+/, "")
		.replace(/^\s*\[[ xX]\]\s+/, "")
		.trim();
}

/**
 * Sentences of the text: lines, then splits after `.`, `;`, `!` or `?` when a capital letter,
 * quote or bracket follows. "Oct. 15" and "U.S. citizens" stay whole.
 */
export function splitSentences(text: string): string[] {
	const out: string[] = [];
	for (const line of text.split(/\r?\n/)) {
		for (const s of stripMarkdown(line).replace(/([.;!?])\s+(?=["“([A-Z])/g, "$1\n").split("\n")) {
			const t = stripMarkdown(s);
			if (t) out.push(t);
		}
	}
	return out;
}

function labelValue(lines: string[], re: RegExp): string | null {
	for (const l of lines) {
		const m = re.exec(stripMarkdown(l));
		if (m && m[1].trim()) return stripMarkdown(m[1].split(/\.\s|\.$|;|\s[–—|]\s/)[0]).slice(0, 120) || null;
	}
	return null;
}

export function extractFunder(lines: string[], sentences: string[]): string | null {
	const labelled = labelValue(lines, /^(?:funder|sponsor|funding (?:agency|body|organi[sz]ation)|agency|offered by|funded by|sponsored by|organi[sz]ation|foundation|administered by)\s*[:：]\s*(.+)$/i);
	if (labelled) return labelled;
	for (const s of sentences) {
		const m = /\b(?:[Oo]ffered|[Ff]unded|[Ss]ponsored|[Aa]dministered|[Aa]warded|[Ss]upported|[Pp]rovided) by (?:the )?([A-Z][A-Za-z0-9&.'’ -]{2,80}?)(?=[.,;:()]|\s(?:to|for|in|and|through|with|as)\b|$)/.exec(s);
		if (m) return m[1].trim();
	}
	return null;
}

/**
 * The application deadline and, when stated separately, the letters deadline. A sentence that
 * talks about letters, references or recommenders and a due date sets the letters deadline; a
 * sentence with deadline wording and no letter wording sets the application deadline. Strong
 * wording ("deadline", "due", "apply by", "must be received by") wins over a bare "by <date>";
 * sentences about notification, start or award dates are skipped. Vague wording ("rolling",
 * "end of month") yields nothing.
 */
export function extractDeadlines(sentences: string[], todayIso: string): { deadline: string | null; lettersDeadline: string | null } {
	const app: { strict: boolean; iso: string }[] = [];
	const letters: { strict: boolean; iso: string }[] = [];
	for (const s of sentences) {
		const strict = STRICT_DEADLINE.test(s);
		if (!strict && !WEAK_DEADLINE.test(s)) continue;
		if (!strict && NOT_A_DEADLINE.test(s)) continue;
		const dates = findDates(s, todayIso);
		if (dates.length === 0) continue;
		const kw = (STRICT_DEADLINE.exec(s) ?? WEAK_DEADLINE.exec(s))!;
		const chosen = dates.find((d) => d.index >= kw.index) ?? dates[dates.length - 1];
		const aboutLetters = LETTER_WORDS.test(s);
		if (aboutLetters) {
			letters.push({ strict, iso: chosen.iso });
			// "Applications and letters are due …" dates both.
			if (/\bapplications?\b/i.test(s) && !/\bletters?\b[^.]*\bapplications?\b/i.test(s)) app.push({ strict, iso: chosen.iso });
		} else {
			app.push({ strict, iso: chosen.iso });
		}
	}
	const pick = (c: { strict: boolean; iso: string }[]) => c.find((x) => x.strict)?.iso ?? c[0]?.iso ?? null;
	return { deadline: pick(app), lettersDeadline: pick(letters) };
}

/** The first money expression with a currency (symbol or code) worth at least 100; sentences about fees are skipped. */
export function extractAmount(sentences: string[]): string | null {
	for (const s of sentences) {
		if (/\bfees?\b/i.test(s)) continue;
		for (const re of [AMOUNT_SYMBOL, AMOUNT_CODE]) {
			re.lastIndex = 0;
			for (const m of s.matchAll(re)) {
				if (amountValue(m[0]) >= 100) return m[0].trim().replace(/\s+/g, " ");
			}
		}
	}
	return null;
}

export function amountValue(s: string): number {
	const m = /(\d[\d,]*(?:\.\d+)?)\s?([kK])?/.exec(s);
	if (!m) return 0;
	const n = Number(m[1].replace(/,/g, ""));
	return m[2] ? n * 1000 : n;
}

/** Lines of the block under a heading matching `headingRe`, up to the next heading-like line or two blank lines. */
export function blockUnder(lines: string[], headingRe: RegExp): string[] {
	const start = lines.findIndex((l) => headingRe.test(l));
	if (start < 0) return [];
	const out: string[] = [];
	let blanks = 0;
	for (let i = start + 1; i < lines.length; i++) {
		const l = lines[i];
		if (!l) {
			blanks++;
			if (blanks >= 2 && out.length) break;
			continue;
		}
		blanks = 0;
		if (HEADING_LIKE.test(l) && !/^\s*(?:[-*+•]|\d+[.)])\s/.test(l) && out.length) break;
		out.push(l);
	}
	return out;
}

/** Eligibility statements: the block under an Eligibility heading plus sentences elsewhere with eligibility wording. */
export function extractEligibility(lines: string[], sentences: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const add = (s: string) => {
		const t = stripMarkdown(s).replace(/\s+/g, " ").trim();
		if (t.length < 8) return;
		const key = t.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
		if (seen.has(key) || out.length >= 12) return;
		seen.add(key);
		out.push(t.slice(0, 240));
	};
	for (const l of blockUnder(lines, ELIGIBILITY_HEADING)) {
		for (const s of splitSentences(l)) add(s);
	}
	for (const s of sentences) {
		if (STRONG_ELIGIBILITY.test(s) && ELIGIBILITY_TOPIC.test(s) && !isMaterialsSentence(s)) add(s);
	}
	return out;
}

function isMaterialsSentence(s: string): boolean {
	return /\b(submit|upload|attach|include|provide)\b/i.test(s) && materialCategory(s) !== "other" && !/\b(citizen|resident|enrolled|GPA|standing)\b/i.test(s);
}

/**
 * Required materials: every canonical kind mentioned anywhere in the text, labelled, in order
 * of first mention; letters carry their count. Bullets of a Materials block that match no
 * kind are kept verbatim.
 */
export function extractMaterials(lines: string[], sentences: string[]): string[] {
	const firstIndex = new Map<MaterialCategory, number>();
	let letterLabel: string | null = null;
	sentences.forEach((s, i) => {
		for (const part of s.split(/[,;]|\band\b/i)) {
			const category = materialCategory(part);
			if (category === "other" || NEGATED.test(part)) continue;
			if (!firstIndex.has(category)) firstIndex.set(category, i);
			if (category === "letters" && !letterLabel) {
				const n = lettersCount(part) ?? lettersCount(s);
				letterLabel = n ? `${n} letters of recommendation` : "Letters of recommendation";
			}
		}
	});
	const ordered = Array.from(firstIndex.entries()).sort((a, b) => a[1] - b[1]);
	const out: string[] = ordered.map(([c]) => (c === "letters" ? letterLabel! : CATEGORY_LABELS[c as keyof typeof CATEGORY_LABELS]));
	for (const l of blockUnder(lines, MATERIALS_HEADING)) {
		if (!/^\s*(?:[-*+•]|\d+[.)])\s/.test(l)) continue;
		const item = stripMarkdown(l).replace(/\s+/g, " ").slice(0, 120);
		if (materialCategory(item) === "other" && item.length >= 3 && !out.some((o) => o.toLowerCase() === item.toLowerCase())) out.push(item);
	}
	return out;
}
