/**
 * Required materials: which kind each one is, which notes or files in the Materials folder
 * answer it, and the `## Materials` checklist that records the result. Everything here is
 * deterministic keyword matching; no model is involved.
 */

import type { FileInfo } from "./vault";

export type MaterialCategory = "cv" | "transcript" | "personal-statement" | "research-statement" | "budget" | "letters" | "other";

const CATEGORY_PATTERNS: [MaterialCategory, RegExp][] = [
	["letters", /\b(?:letters?\s+of\s+(?:recommendation|reference|support)|recommendation\s+letters?|reference\s+letters?|recommenders?)\b/i],
	["cv", /\b(?:cv|curriculum\s+vitae|resume)\b|r[ée]sum[ée]/i],
	["transcript", /\btranscripts?\b/i],
	["budget", /\bbudget\b/i],
	["research-statement", /\b(?:research\s+(?:statement|proposal|plan|essay|summary)|statement\s+of\s+research|project\s+(?:proposal|description|narrative|summary)|proposal)\b/i],
	["personal-statement", /\b(?:personal\s+(?:statement|essay)|statement\s+of\s+purpose|motivation\s+letter|cover\s+letter|personal\s+narrative|essay)\b/i],
];

/** The canonical label the note uses for each category (letters carry their own count). */
export const CATEGORY_LABELS: Record<Exclude<MaterialCategory, "other" | "letters">, string> = {
	cv: "CV",
	transcript: "Transcript",
	"personal-statement": "Personal statement",
	"research-statement": "Research statement",
	budget: "Budget",
};

/** The kind of material a required-materials line (or a file name) describes. */
export function materialCategory(text: string): MaterialCategory {
	const t = text.replace(/[_-]+/g, " ");
	for (const [category, re] of CATEGORY_PATTERNS) if (re.test(t)) return category;
	return "other";
}

/** `3` from "3 letters of recommendation" or "three reference letters"; null when no count is written. */
export function lettersCount(text: string): number | null {
	if (materialCategory(text) !== "letters") return null;
	const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6 };
	const m = /\b(\d|one|two|three|four|five|six)\b(?=\s*(?:\(\d\)\s*)?(?:letters?|references?|recommendations?|recommenders?))/i.exec(text);
	if (!m) return null;
	const w = m[1].toLowerCase();
	return words[w] ?? Number(w);
}

const STOPWORDS = new Set(["the", "and", "with", "from", "your", "that", "this", "copy", "copies", "official", "unofficial", "current", "signed", "page", "pages", "word", "words", "maximum", "minimum", "required", "including", "about"]);

/** Words of a material line worth matching against file names (letters ≥ 4, no stopwords). */
export function materialTokens(text: string): string[] {
	return Array.from(
		new Set(
			text
				.toLowerCase()
				.replace(/\([^)]*\)/g, " ")
				.split(/[^a-z0-9]+/)
				.filter((w) => w.length >= 4 && !STOPWORDS.has(w)),
		),
	);
}

export interface MaterialMatch {
	/** The required material as listed in the note. */
	material: string;
	category: MaterialCategory;
	/** Vault paths of the notes or files that answer it, in path order. */
	files: string[];
}

/** True when `file` answers the material: same category, or (for "other") every token in the file name. */
export function fileMatches(material: string, category: MaterialCategory, file: FileInfo): boolean {
	const fileCategory = materialCategory(file.basename);
	if (category !== "other") return fileCategory === category;
	if (fileCategory !== "other") return false;
	const tokens = materialTokens(material);
	if (tokens.length === 0) return false;
	const name = file.basename.toLowerCase().replace(/[_-]+/g, " ");
	return tokens.every((t) => name.includes(t));
}

/** Each required material with the files in the Materials folder that answer it. Letters never match files. */
export function matchMaterials(required: string[], files: FileInfo[]): MaterialMatch[] {
	return required.map((material) => {
		const category = materialCategory(material);
		const matched = category === "letters" ? [] : files.filter((f) => fileMatches(material, category, f)).map((f) => f.path);
		return { material, category, files: matched };
	});
}

export interface LettersProgress {
	received: number;
	total: number;
}

function link(path: string, inTable = false): string {
	const target = path.endsWith(".md") ? path.replace(/\.md$/, "") : path;
	return inTable ? `[[${target.replace(/\|/g, "\\|")}]]` : `[[${target}]]`;
}

/**
 * The `## Materials` checklist: ticked when a file answers the item (or, for letters, when
 * every expected letter is received), with links to what was found and a hint for what is
 * missing. Re-running produces the same text, so the section can be rewritten safely.
 */
export function renderMaterialsSection(matches: MaterialMatch[], materialsFolder: string, letters: LettersProgress): string {
	if (matches.length === 0) return `_No required materials listed in the properties. Add them under \`materials:\` and run Check materials again._`;
	const lines: string[] = [];
	for (const m of matches) {
		if (m.category === "letters") {
			const total = letters.total || null;
			const done = total !== null && letters.received >= total;
			const state = total === null ? "no recommenders named yet under Letters" : `${letters.received} of ${total} received`;
			lines.push(`- [${done ? "x" : " "}] ${m.material} — ${state}`);
		} else if (m.files.length > 0) {
			lines.push(`- [x] ${m.material} — ${m.files.map((f) => link(f)).join(", ")}`);
		} else {
			lines.push(`- [ ] ${m.material} — missing: nothing in \`${materialsFolder}\` matches ${hintFor(m)}`);
		}
	}
	return lines.join("\n");
}

function hintFor(m: MaterialMatch): string {
	switch (m.category) {
		case "cv":
			return '"cv" or "resume"';
		case "transcript":
			return '"transcript"';
		case "personal-statement":
			return '"personal statement" or "statement of purpose"';
		case "research-statement":
			return '"research statement" or "proposal"';
		case "budget":
			return '"budget"';
		default: {
			const tokens = materialTokens(m.material);
			return tokens.length ? tokens.map((t) => `"${t}"`).join(" and ") : "its name";
		}
	}
}

export interface MaterialsChecklist {
	ready: number;
	total: number;
}

/** Ticked and total items of a `## Materials` section body (`- [x] …` / `- [ ] …`). */
export function materialsProgress(body: string | null): MaterialsChecklist {
	let ready = 0;
	let total = 0;
	if (!body) return { ready, total };
	for (const line of body.split(/\r?\n/)) {
		const m = /^\s*[-*+]\s+\[([ xX])\]\s+/.exec(line);
		if (!m) continue;
		total++;
		if (m[1] !== " ") ready++;
	}
	return { ready, total };
}
