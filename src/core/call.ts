/**
 * The structured call: what the regex pass found, what the local model added, and the merge
 * (regex wins on conflict). The model's output is validated field by field; its dates are
 * re-read with the deterministic parser, never trusted as written.
 */

import { parseDateText } from "./dates";
import type { RegexExtraction } from "./extract";
import { lettersCount, materialCategory } from "./materials";
import { stripThinkTags } from "./ollama";

export interface CallFields {
	name: string;
	funder: string;
	amount: string;
	deadline: string | null;
	lettersDeadline: string | null;
	eligibility: string[];
	materials: string[];
	/** Letters the call asks for; 0 when none are mentioned. */
	lettersCount: number;
	keywords: string[];
}

export interface ModelCall {
	name: string | null;
	funder: string | null;
	amount: string | null;
	deadline: string | null;
	lettersDeadline: string | null;
	eligibility: string[];
	materials: string[];
	lettersCount: number | null;
	keywords: string[];
}

export const LIMITS = { eligibility: 12, materials: 12, keywords: 12, itemChars: 240 } as const;

export function extractionSystemPrompt(): string {
	return [
		"You extract structured facts from a call for applications (a fellowship, grant or scholarship). Reply with one JSON object and nothing else: no prose, no markdown fences.",
		"Schema (every key required; use null or [] when the call does not say):",
		'{"name": string|null, "funder": string|null, "amount": string|null, "deadline": string|null, "letters_deadline": string|null, "eligibility": string[], "materials": string[], "letters_count": number|null, "keywords": string[]}',
		"Rules:",
		"- name: the official name of the fellowship, grant or scholarship, without the funder's name unless it is part of the title.",
		"- funder: the organisation that pays or administers it (agency, foundation, university office).",
		"- amount: the stipend, award or budget cap exactly as written, including currency and period (for example \"$38,000 per year\"); null when not stated.",
		"- deadline: the application deadline text exactly as written in the call (for example \"October 15, 2026\"); null when there is none or it is vague (\"rolling\").",
		"- letters_deadline: the deadline for letters of recommendation or references, exactly as written, only when the call states one; null otherwise.",
		`- eligibility: up to ${LIMITS.eligibility} short statements (under 30 words each) of who may apply: citizenship, degree level, year of study, field, GPA, age, institution. Copy the call's wording.`,
		`- materials: up to ${LIMITS.materials} required application components, one per item, in the call's words (for example "CV", "Unofficial transcript", "Research statement (2 pages)", "3 letters of recommendation", "Budget justification").`,
		"- letters_count: the number of letters of recommendation or references required; null when none are mentioned.",
		`- keywords: up to ${LIMITS.keywords} lowercase topic words or phrases from the call (fields, methods, priorities), most specific first.`,
		"Never invent anything that is not in the call.",
	].join("\n");
}

export function extractionUserMessage(callText: string): string {
	return `Call for applications:\n\n${callText.trim()}\n\nReturn the JSON object now.`;
}

/** The first JSON object in a model reply (fences, prose and <think> blocks tolerated). Null when none parses. */
export function parseJsonReply(reply: string): Record<string, unknown> | null {
	const text = stripThinkTags(reply).replace(/```(?:json)?/gi, "");
	const start = text.indexOf("{");
	if (start < 0) return null;
	let depth = 0;
	let inString = false;
	let escaped = false;
	for (let i = start; i < text.length; i++) {
		const ch = text[i];
		if (inString) {
			if (escaped) escaped = false;
			else if (ch === "\\") escaped = true;
			else if (ch === '"') inString = false;
			continue;
		}
		if (ch === '"') inString = true;
		else if (ch === "{") depth++;
		else if (ch === "}") {
			depth--;
			if (depth === 0) {
				try {
					const parsed: unknown = JSON.parse(text.slice(start, i + 1));
					return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
				} catch {
					return null;
				}
			}
		}
	}
	return null;
}

export function str(v: unknown, max = 160): string | null {
	if (typeof v !== "string") return null;
	const t = v.replace(/\s+/g, " ").trim();
	return t ? t.slice(0, max) : null;
}

export function strList(v: unknown, max: number, itemChars: number = LIMITS.itemChars): string[] {
	if (!Array.isArray(v)) return [];
	const out: string[] = [];
	const seen = new Set<string>();
	for (const item of v) {
		const s = str(item, itemChars);
		if (!s) continue;
		const key = s.toLowerCase();
		if (seen.has(key)) continue;
		seen.add(key);
		out.push(s);
		if (out.length >= max) break;
	}
	return out;
}

function smallInt(v: unknown, max: number): number | null {
	const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
	return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
}

/** Validates a parsed model reply against the schema; unknown or malformed fields become null/empty. */
export function validateModelCall(json: Record<string, unknown> | null, todayIso: string): ModelCall {
	const j = json ?? {};
	return {
		name: str(j.name, 140),
		funder: str(j.funder, 120),
		amount: str(j.amount, 80),
		deadline: parseDateText(str(j.deadline, 80), todayIso),
		lettersDeadline: parseDateText(str(j.letters_deadline ?? j.lettersDeadline, 80), todayIso),
		eligibility: strList(j.eligibility, LIMITS.eligibility),
		materials: strList(j.materials, LIMITS.materials, 120),
		lettersCount: smallInt(j.letters_count ?? j.lettersCount, 10),
		keywords: strList(j.keywords, LIMITS.keywords, 60).map((k) => k.toLowerCase()),
	};
}

export function emptyModelCall(): ModelCall {
	return { name: null, funder: null, amount: null, deadline: null, lettersDeadline: null, eligibility: [], materials: [], lettersCount: null, keywords: [] };
}

function normalKey(s: string): string {
	return s
		.toLowerCase()
		.replace(/\([^)]*\)/g, " ")
		.replace(/[^a-z0-9]+/g, " ")
		.trim();
}

/** Regex items first, then model items that say something new (by normalised text or, for materials, by kind). */
function union(regexItems: string[], modelItems: string[], max: number, sameKind?: (a: string, b: string) => boolean): string[] {
	const out = [...regexItems];
	for (const m of modelItems) {
		if (out.length >= max) break;
		const k = normalKey(m);
		if (!k) continue;
		if (out.some((o) => normalKey(o) === k || k.includes(normalKey(o)) || normalKey(o).includes(k))) continue;
		if (sameKind && out.some((o) => sameKind(o, m))) continue;
		out.push(m);
	}
	return out;
}

function sameMaterialKind(a: string, b: string): boolean {
	const ca = materialCategory(a);
	return ca !== "other" && ca === materialCategory(b);
}

/**
 * Regex facts win where they exist; the model fills the rest. Eligibility and materials are the
 * regex lists followed by whatever the model adds that is not already there (a second "CV"
 * under another name is dropped). The first line of the call is the last resort for the name.
 */
export function mergeCall(regex: RegexExtraction, model: ModelCall): CallFields {
	const materials = union(regex.materials, model.materials, LIMITS.materials, sameMaterialKind);
	const countFromMaterials = materials.map(lettersCount).find((n): n is number => n !== null) ?? null;
	const lettersTotal = regex.lettersCount ?? countFromMaterials ?? model.lettersCount ?? 0;
	return {
		name: regex.name ?? model.name ?? regex.titleGuess ?? "Untitled opportunity",
		funder: regex.funder ?? model.funder ?? "Unknown funder",
		amount: regex.amount ?? model.amount ?? "",
		deadline: regex.deadline ?? model.deadline,
		lettersDeadline: regex.lettersDeadline ?? model.lettersDeadline,
		eligibility: union(regex.eligibility, model.eligibility, LIMITS.eligibility),
		materials,
		lettersCount: lettersTotal,
		keywords: model.keywords,
	};
}
