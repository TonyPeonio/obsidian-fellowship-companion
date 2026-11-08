/**
 * Letter requests: what the call asks letters to address (deterministic sentence pick, with an
 * optional model summary that must stay grounded in the call), and the request note drafted for
 * each recommender. Nothing here sends anything; the note is a draft for the user to copy.
 */

import { parseJsonReply, strList } from "./call";
import { cleanFileName } from "./note";

const LETTER_WORDS = /\b(letters?|recommend(?:ation|ations|ers?)|referees?|references?)\b/i;
const GUIDANCE_WORDS = /\b(should|must|address|speak|comment|evaluate|assess|describe|discuss|attest|highlight|focus|ability|potential|familiar|know|knowledge of|capacity|evidence|promise|merit|impact|qualit(?:y|ies))\b/i;

/**
 * Sentences of the call that say what letters should cover: they mention letters, references or
 * recommenders and carry guidance wording; the bare count/deadline sentences are left out.
 */
export function lettersGuidance(sentences: string[]): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	for (const s of sentences) {
		if (!LETTER_WORDS.test(s) || !GUIDANCE_WORDS.test(s)) continue;
		if (/\b(due|deadline|submit(?:ted)? by|no later than|upload)\b/i.test(s) && !/\b(should|must address|speak to|comment on|evaluate|assess)\b/i.test(s)) continue;
		const key = s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(s);
		if (out.length >= 6) break;
	}
	return out;
}

export function guidanceSystemPrompt(): string {
	return [
		"You summarise what a call for applications asks letters of recommendation to address. Reply with one JSON object and nothing else: no prose, no markdown fences.",
		'Schema: {"points": string[]}',
		"Rules:",
		"- points: up to 5 short phrases (under 20 words each), each restating one thing the call says recommenders should speak to (qualities, experiences, how well they know the applicant).",
		"- Use the call's own words wherever possible. If the call says nothing about the content of letters, return an empty list.",
		"Never invent requirements that are not in the call.",
	].join("\n");
}

export function guidanceUserMessage(callText: string): string {
	return `Call for applications:\n\n${callText.trim()}\n\nReturn the JSON object now.`;
}

/** Words of five letters or more, lower-cased, used for grounding. */
function contentWords(s: string): string[] {
	return s
		.toLowerCase()
		.split(/[^a-z0-9]+/)
		.filter((w) => w.length >= 5);
}

/**
 * Validates a model reply: the points list, each kept only when at least 60% of its content
 * words (5+ letters) occur in the call text, so the draft never claims something the call
 * does not say. Null when the reply is not JSON.
 */
export function parseGuidance(reply: string, callText: string): string[] | null {
	const json = parseJsonReply(reply);
	if (!json) return null;
	const haystack = new Set(contentWords(callText));
	const out: string[] = [];
	for (const p of strList(json.points, 5, 200)) {
		const words = contentWords(p);
		if (words.length === 0) continue;
		const hits = words.filter((w) => haystack.has(w) || haystack.has(w.replace(/s$/, "")) || haystack.has(`${w}s`)).length;
		if (hits / words.length >= 0.6) out.push(p);
	}
	return out;
}

export interface LetterRequestInput {
	recommender: string;
	name: string;
	funder: string;
	amount: string;
	deadline: string | null;
	lettersDeadline: string | null;
	url: string;
	/** Vault path of the fellowship note (with `.md`). */
	notePath: string;
	/** What the call asks letters to address (model points or copied sentences). */
	guidance: string[];
	/** Whether `guidance` came from the model (noted in the draft) or was copied from the call. */
	guidanceSource: "model" | "call" | "none";
	/** Materials the applicant will attach: the required materials except the letters themselves. */
	materials: string[];
	today: string;
}

export function letterFileName(recommender: string, name: string): string {
	return `${cleanFileName(recommender) || "Recommender"} - ${cleanFileName(name) || "Untitled opportunity"}.md`;
}

/** The request note: a summary for the recommender, what to address, what you will send, and a short message to copy. */
export function renderLetterRequest(p: LetterRequestInput): string {
	const dueLine = p.lettersDeadline ? `${p.lettersDeadline}` : p.deadline ? `${p.deadline} (the application deadline; the call states no separate letters deadline)` : "not stated in the call";
	const noteLink = `[[${p.notePath.replace(/\.md$/, "")}]]`;
	const guidance = p.guidance.length ? p.guidance.map((g) => `- ${g}`).join("\n") : "_The call does not say what letters should address. Ask the recommender to speak to your fit for the opportunity; see the call in the fellowship note._";
	const guidanceNote = p.guidanceSource === "model" ? "_Points summarised from the call by the local model and checked against its wording._" : p.guidanceSource === "call" ? "_Sentences copied from the call._" : "";
	const materials = p.materials.length ? p.materials.map((m) => `- ${m}`).join("\n") : "- _(nothing listed; add what you will send)_";
	const askLines = [
		`Dear ${p.recommender},`,
		"",
		`I am applying for the ${p.name}${p.funder && p.funder !== "Unknown funder" ? ` (${p.funder})` : ""}${p.amount ? `, which provides ${p.amount}` : ""}. Would you be willing to write a letter of recommendation for me? Letters are due ${p.lettersDeadline ?? p.deadline ?? "[date]"}.`,
		"",
		p.guidance.length ? `The call asks letters to address:\n${p.guidance.map((g) => `- ${g}`).join("\n")}` : "The call does not specify what letters should address; anything about my work with you and my fit for the opportunity would help.",
		"",
		`I will send you ${p.materials.length ? p.materials.map((m) => m.toLowerCase()).join(", ") : "my application materials"}${p.url ? ` and the call is at ${p.url}` : ""}. Thank you for considering it.`,
		"",
		"Best regards,",
		"[your name]",
	];
	return [
		"---",
		`recommender: ${quoteYaml(p.recommender)}`,
		`fellowship: ${quoteYaml(p.name)}`,
		`funder: ${quoteYaml(p.funder)}`,
		`letters_deadline: ${p.lettersDeadline ?? ""}`,
		`asked_on: ${p.today}`,
		"source: letter-request",
		"---",
		`# Letter request: ${p.recommender} — ${p.name}`,
		"",
		`_Drafted ${p.today} by Fellowship Companion from ${noteLink}. This is a draft for you to send yourself; nothing is sent automatically._`,
		"",
		"## Summary",
		"",
		`- **Opportunity:** ${p.name}`,
		`- **Funder:** ${p.funder}`,
		...(p.amount ? [`- **Amount:** ${p.amount}`] : []),
		`- **Application deadline:** ${p.deadline ?? "not stated"}`,
		`- **Letters due:** ${dueLine}`,
		...(p.url ? [`- **Call:** ${p.url}`] : []),
		`- **Note:** ${noteLink}`,
		"",
		"## What the letter should address",
		"",
		guidance,
		...(guidanceNote ? ["", guidanceNote] : []),
		"",
		"## Materials I will attach",
		"",
		materials,
		"",
		"## Draft message",
		"",
		...askLines,
		"",
	].join("\n");
}

function quoteYaml(s: string): string {
	if (s === "") return '""';
	if (/[:#[\]{}"'|>&*!%@`,]/.test(s) || /^\s|\s$/.test(s)) return `"${s.replace(/"/g, '\\"')}"`;
	return s;
}
