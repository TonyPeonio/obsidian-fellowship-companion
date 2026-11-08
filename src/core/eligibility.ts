/**
 * The eligibility screen: each criterion the call states, compared with the user's Profile
 * note. Numeric and categorical rules (GPA, citizenship, degree level, year, age, field) are
 * decided deterministically; the local model, when available, assesses the rest. Criteria are
 * quoted from the note's own list and only when they appear in the call text, so the screen
 * never invents a requirement.
 */

import { parseJsonReply, str } from "./call";
import { parseFrontmatter } from "./frontmatter";

export type Verdict = "likely eligible" | "check" | "not eligible";
export const VERDICTS: readonly Verdict[] = ["likely eligible", "check", "not eligible"];

export interface Profile {
	citizenship: string;
	degree: string;
	year: string;
	gpa: number | null;
	field: string;
	age: number | null;
	institution: string;
	/** Every `key: value` found, lower-cased keys, for the model's view of the profile. */
	fields: Record<string, string>;
}

const KEY_ALIASES: Record<string, keyof Omit<Profile, "fields" | "gpa" | "age">> = {
	citizenship: "citizenship",
	nationality: "citizenship",
	citizen: "citizenship",
	degree: "degree",
	"degree level": "degree",
	level: "degree",
	program: "degree",
	programme: "degree",
	year: "year",
	"year of study": "year",
	class: "year",
	standing: "year",
	field: "field",
	major: "field",
	discipline: "field",
	department: "field",
	institution: "institution",
	university: "institution",
	school: "institution",
	college: "institution",
};

/** Reads `Profile.md`: frontmatter keys plus `Key: value`, `- Key: value` and `**Key:** value` lines in the body. */
export function parseProfile(content: string): Profile {
	const fields: Record<string, string> = {};
	const fm = parseFrontmatter(content);
	for (const [k, v] of Object.entries(fm.data)) fields[k.toLowerCase().replace(/[_-]+/g, " ")] = Array.isArray(v) ? v.join(", ") : v;
	for (const raw of fm.body.split(/\r?\n/)) {
		const m = /^\s*(?:[-*+]\s+)?\**([A-Za-z][A-Za-z _-]{1,30}?)\**\s*[:：]\**\s*(.+?)\s*$/.exec(raw);
		if (!m) continue;
		const key = m[1].trim().toLowerCase().replace(/[_-]+/g, " ");
		if (!(key in fields)) fields[key] = m[2].trim();
	}
	const profile: Profile = { citizenship: "", degree: "", year: "", gpa: null, field: "", age: null, institution: "", fields };
	for (const [key, value] of Object.entries(fields)) {
		const target = KEY_ALIASES[key];
		if (target && !profile[target]) profile[target] = value;
		if (key === "gpa" || key === "grade point average") {
			const n = Number(/\d\.\d{1,2}|\d/.exec(value)?.[0]);
			if (Number.isFinite(n)) profile.gpa = n;
		}
		if (key === "age") {
			const n = Number(/\d{1,3}/.exec(value)?.[0]);
			if (Number.isFinite(n)) profile.age = n;
		}
	}
	return profile;
}

export interface Screening {
	/** The criterion, quoted as the note lists it. */
	criterion: string;
	verdict: Verdict;
	reason: string;
	source: "rule" | "model" | "none";
}

// ---------------------------------------------------------------- deterministic rules

const US = /\b(?:u\.?s\.?a?\.?|united states|american)\b/i;
const UNDERGRAD = /\b(?:undergraduate|undergraduates|undergrad|bachelor'?s?|b\.?s\.?|b\.?a\.?|college students?)\b/i;
const GRAD = /\b(?:graduate students?|graduate-level|graduate degree|master'?s?|m\.?s\.?|m\.?a\.?|ph\.?d\.?|doctoral|doctorate|postgraduate)\b/i;
const YEARS: [RegExp, string][] = [
	[/\b(?:freshm[ae]n|first[- ]years?)\b/i, "first-year"],
	[/\b(?:sophomores?|second[- ]years?)\b/i, "second-year"],
	[/\b(?:juniors?|third[- ]years?)\b/i, "third-year"],
	[/\b(?:seniors?|fourth[- ]years?|final[- ]years?)\b/i, "fourth-year"],
];
const STEM_FIELDS = /\b(?:physics|chemistry|biology|biochemistry|engineering|mathematics|math|statistics|computer science|computing|materials|geology|geophysics|astronomy|neuroscience|data science|environmental science|earth science|ocean|atmospheric)\b/i;

function yearLabel(text: string): string | null {
	for (const [re, label] of YEARS) if (re.test(text)) return label;
	return null;
}

function yearLabels(text: string): string[] {
	return YEARS.filter(([re]) => re.test(text)).map(([, label]) => label);
}

/** The GPA threshold in a criterion, ignoring the scale ("on a 4.0 scale"). */
export function gpaThreshold(criterion: string): number | null {
	if (!/\b(?:GPA|grade point average)\b/i.test(criterion)) return null;
	for (const m of criterion.matchAll(/\b(\d\.\d{1,2})\b/g)) {
		const after = criterion.slice(m.index + m[0].length, m.index + m[0].length + 12);
		const before = criterion.slice(Math.max(0, m.index - 8), m.index);
		if (/^\s*(?:-?\s*point|scale)/i.test(after) || /\bon an?\s*$/i.test(before)) continue;
		return Number(m[1]);
	}
	return null;
}

interface RuleResult {
	verdict: Verdict;
	reason: string;
}

function gpaRule(c: string, p: Profile): RuleResult | null {
	const min = gpaThreshold(c);
	if (min === null) return null;
	if (p.gpa === null) return { verdict: "check", reason: `the call sets a ${min} GPA minimum; add \`gpa\` to your profile` };
	return p.gpa >= min ? { verdict: "likely eligible", reason: `GPA ${p.gpa} meets the ${min} minimum` } : { verdict: "not eligible", reason: `GPA ${p.gpa} is below the ${min} minimum` };
}

function citizenshipRule(c: string, p: Profile): RuleResult | null {
	if (!/\b(?:citizens?|citizenship|nationals?|nationality|permanent residents?)\b/i.test(c)) return null;
	if (/\b(?:any|all) (?:nationalit(?:y|ies)|citizenships?|countr(?:y|ies))\b|\bno (?:citizenship|nationality) requirement\b|\bregardless of (?:citizenship|nationality)\b|\binternational (?:students|applicants) (?:are|may|welcome)/i.test(c)) {
		return { verdict: "likely eligible", reason: "the call is open to any nationality" };
	}
	if (!p.citizenship) return { verdict: "check", reason: "the call restricts citizenship; add `citizenship` to your profile" };
	const profileUs = US.test(p.citizenship);
	const wantsUs = US.test(c);
	const allowsResidents = /\bpermanent residents?\b|\bgreen card\b/i.test(c);
	const profileResident = /\bpermanent resident\b|\bgreen card\b/i.test(p.citizenship);
	if (wantsUs) {
		if (profileUs) return { verdict: "likely eligible", reason: `profile citizenship "${p.citizenship}" matches the U.S. requirement` };
		if (allowsResidents && profileResident) return { verdict: "likely eligible", reason: "permanent residents are eligible" };
		return { verdict: "not eligible", reason: `the call requires U.S. citizenship${allowsResidents ? " or permanent residency" : ""}; profile says "${p.citizenship}"` };
	}
	const words = p.citizenship
		.toLowerCase()
		.split(/[^a-z]+/)
		.filter((w) => w.length >= 4);
	if (words.some((w) => c.toLowerCase().includes(w))) return { verdict: "likely eligible", reason: `profile citizenship "${p.citizenship}" is named in the criterion` };
	return { verdict: "check", reason: `the criterion names a citizenship; profile says "${p.citizenship}"` };
}

function degreeRule(c: string, p: Profile): RuleResult | null {
	const wantsUndergrad = UNDERGRAD.test(c);
	const wantsGrad = GRAD.test(c);
	if (!wantsUndergrad && !wantsGrad) return null;
	if (/\b(?:hold|holds|holding|completed|earned|received|awarded|obtained|have (?:a|an|their))\b/i.test(c)) return { verdict: "check", reason: "the criterion is about a degree already held; compare it with your expected graduation" };
	if (!p.degree) return { verdict: "check", reason: "the call restricts degree level; add `degree` to your profile" };
	const isUndergrad = UNDERGRAD.test(p.degree);
	const isGrad = GRAD.test(p.degree);
	if (!isUndergrad && !isGrad) return { verdict: "check", reason: `could not tell the level of profile degree "${p.degree}"` };
	if ((isUndergrad && wantsUndergrad) || (isGrad && wantsGrad)) return { verdict: "likely eligible", reason: `profile degree "${p.degree}" matches the level the call names` };
	return { verdict: "not eligible", reason: `the call is for ${wantsUndergrad ? "undergraduate" : "graduate"} students; profile degree is "${p.degree}"` };
}

function yearRule(c: string, p: Profile): RuleResult | null {
	const wanted = yearLabels(c);
	if (wanted.length === 0) return null;
	if (/\bfirst[- ]year graduate\b|\bfirst[- ]year (?:doctoral|phd)\b/i.test(c) && wanted.length === 1) return null;
	if (!p.year) return { verdict: "check", reason: "the call restricts year of study; add `year` to your profile" };
	const mine = yearLabel(p.year);
	if (!mine) return { verdict: "check", reason: `could not tell the year from profile "${p.year}"` };
	return wanted.includes(mine) ? { verdict: "likely eligible", reason: `profile year "${p.year}" is among those named` } : { verdict: "not eligible", reason: `the call names ${wanted.join(", ")} students; profile year is "${p.year}"` };
}

function ageRule(c: string, p: Profile): RuleResult | null {
	const max = /\b(?:under|below|no older than|younger than|not (?:be )?(?:older than|over)|at most|up to)\s+(?:the age of\s+)?(\d{2})\b|\b(\d{2})\s+years?\s+(?:of age|old)\s+or\s+younger/i.exec(c);
	const min = /\b(?:at least|over|older than|minimum age(?: of)?)\s+(\d{2})\s+years?\b|\b(\d{2})\s+years?\s+(?:of age|old)\s+or\s+older/i.exec(c);
	if (!max && !min) return null;
	if (!/\b(?:age|years? (?:of age|old))\b/i.test(c)) return null;
	if (p.age === null) return { verdict: "check", reason: "the call has an age limit; add `age` to your profile" };
	const maxAge = max ? Number(max[1] ?? max[2]) : null;
	const minAge = min ? Number(min[1] ?? min[2]) : null;
	if (maxAge !== null && p.age >= maxAge && /\bunder|below|younger than\b/i.test(c)) return { verdict: "not eligible", reason: `age ${p.age} is not under ${maxAge}` };
	if (maxAge !== null && p.age > maxAge) return { verdict: "not eligible", reason: `age ${p.age} is over the ${maxAge} limit` };
	if (minAge !== null && p.age < minAge) return { verdict: "not eligible", reason: `age ${p.age} is under the ${minAge} minimum` };
	return { verdict: "likely eligible", reason: `age ${p.age} is within the limit` };
}

function fieldRule(c: string, p: Profile): RuleResult | null {
	if (!/\b(?:fields?|majors?|disciplines?|STEM|studying|degree in|areas? of study)\b/i.test(c)) return null;
	if (!p.field) return { verdict: "check", reason: "the call restricts the field of study; add `field` to your profile" };
	const words = p.field
		.toLowerCase()
		.split(/[^a-z]+/)
		.filter((w) => w.length >= 4);
	if (words.some((w) => c.toLowerCase().includes(w))) return { verdict: "likely eligible", reason: `profile field "${p.field}" is named in the criterion` };
	if (/\bSTEM\b/.test(c) && STEM_FIELDS.test(p.field)) return { verdict: "likely eligible", reason: `profile field "${p.field}" is a STEM field` };
	return { verdict: "check", reason: `profile field "${p.field}" is not named in the criterion` };
}

const RULES = [gpaRule, citizenshipRule, degreeRule, yearRule, ageRule, fieldRule];

/**
 * The deterministic verdict for one criterion, or null when no rule applies. When several rules
 * fire, any "not eligible" wins, then any "check", else "likely eligible"; reasons are joined.
 */
export function precheck(criterion: string, profile: Profile): Screening | null {
	const results = RULES.map((r) => r(criterion, profile)).filter((r): r is RuleResult => r !== null);
	if (results.length === 0) return null;
	const verdict: Verdict = results.some((r) => r.verdict === "not eligible") ? "not eligible" : results.some((r) => r.verdict === "check") ? "check" : "likely eligible";
	return { criterion, verdict, reason: results.map((r) => r.reason).join("; "), source: "rule" };
}

// ---------------------------------------------------------------- grounding

function normal(s: string): string {
	return s
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/**
 * Criteria that appear in the call text (case, punctuation and whitespace ignored). With no
 * call text (a hand-made note) every criterion is kept. Returns the kept list and the dropped count.
 */
export function groundedCriteria(criteria: string[], callText: string): { kept: string[]; dropped: number } {
	const unique = Array.from(new Set(criteria.map((c) => c.trim()).filter(Boolean)));
	if (!callText.trim()) return { kept: unique, dropped: 0 };
	const hay = normal(callText);
	const kept = unique.filter((c) => {
		const n = normal(c);
		return n.length >= 8 && hay.includes(n);
	});
	return { kept, dropped: unique.length - kept.length };
}

// ---------------------------------------------------------------- model

export function screeningSystemPrompt(): string {
	return [
		"You compare an applicant's profile with the eligibility criteria of a fellowship, grant or scholarship. Reply with one JSON object and nothing else: no prose, no markdown fences.",
		'Schema: {"results": [{"index": number, "verdict": "likely eligible"|"check"|"not eligible", "reason": string}]}',
		"Rules:",
		"- One result per numbered criterion, using its number as index.",
		'- "likely eligible" only when the profile clearly satisfies the criterion; "not eligible" only when it clearly fails; otherwise "check" (missing information, ambiguous wording, anything time-dependent).',
		"- reason: one sentence (under 25 words) naming the profile fact you compared.",
		"Never assume facts that are not in the profile.",
	].join("\n");
}

export function screeningUserMessage(criteria: string[], profile: Profile): string {
	const facts = Object.entries(profile.fields).map(([k, v]) => `- ${k}: ${v}`);
	return [`Profile:\n${facts.length ? facts.join("\n") : "- (empty)"}`, `Criteria:\n${criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}`, "Return the JSON object now."].join("\n\n");
}

/** Validates the model reply: in-range indexes, known verdicts, short reasons; first result per index wins. Null when not JSON. */
export function parseScreening(reply: string, criteria: string[]): Map<number, RuleResult> | null {
	const json = parseJsonReply(reply);
	if (!json) return null;
	const out = new Map<number, RuleResult>();
	const results = Array.isArray(json.results) ? json.results : [];
	for (const r of results) {
		if (!r || typeof r !== "object") continue;
		const o = r as Record<string, unknown>;
		const index = typeof o.index === "number" ? o.index : Number(o.index);
		if (!Number.isInteger(index) || index < 1 || index > criteria.length || out.has(index)) continue;
		const verdict = str(o.verdict, 40)?.toLowerCase();
		if (!verdict || !(VERDICTS as readonly string[]).includes(verdict)) continue;
		out.set(index, { verdict: verdict as Verdict, reason: str(o.reason, 200) ?? "" });
	}
	return out;
}

/** Rule verdicts win; the model fills the rest; anything left is "check". */
export function mergeScreening(criteria: string[], profile: Profile, model: Map<number, RuleResult> | null): Screening[] {
	return criteria.map((criterion, i) => {
		const rule = precheck(criterion, profile);
		if (rule) return rule;
		const m = model?.get(i + 1);
		if (m) return { criterion, verdict: m.verdict, reason: m.reason, source: "model" };
		return { criterion, verdict: "check", reason: model ? "the model gave no verdict" : "no rule applies; run with Ollama reachable for a model assessment", source: "none" };
	});
}

export interface ScreeningRenderOptions {
	today: string;
	profilePath: string;
	/** Model name when the model took part; null for a rules-only screen. */
	model: string | null;
	/** Criteria dropped because they do not appear in the call text. */
	dropped: number;
}

export function renderScreening(results: Screening[], o: ScreeningRenderOptions): string {
	const count = (v: Verdict) => results.filter((r) => r.verdict === v).length;
	const lines = [`_Screened ${o.today} against [[${o.profilePath.replace(/\.md$/, "")}]] using ${o.model ? `deterministic rules and ${o.model}` : "deterministic rules only"}. ${count("likely eligible")} likely eligible, ${count("check")} to check, ${count("not eligible")} not eligible.${o.dropped ? ` ${o.dropped} listed criteri${o.dropped === 1 ? "on was" : "a were"} skipped because they do not appear in the call text.` : ""}_`, ""];
	if (results.length === 0) lines.push("_No criteria to screen. Add eligibility statements to the `eligibility` property (they must appear in the call text)._");
	for (const r of results) lines.push(`- **${r.verdict}** — "${r.criterion.replace(/"/g, "'")}" — ${r.reason}${r.source === "rule" ? " _(rule)_" : r.source === "model" ? " _(model)_" : ""}`);
	return lines.join("\n");
}
