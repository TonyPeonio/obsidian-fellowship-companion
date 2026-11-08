import { describe, expect, it } from "vitest";
import { fileMatches, lettersCount, matchMaterials, materialCategory, materialsProgress, renderMaterialsSection } from "../src/core/materials";
import { filesInFolder } from "../src/core/vault";
import { FakeVault } from "./fakes";

const REQUIRED = ["Personal statement (2 pages)", "Research statement", "Unofficial transcripts", "CV", "3 letters of recommendation", "Budget justification", "Writing sample (10 pages)"];

function vault(): FakeVault {
	return new FakeVault({
		"Fellowships/Materials/CV 2026.md": "# CV",
		"Fellowships/Materials/Transcript_Fall2026.pdf": "",
		"Fellowships/Materials/Personal Statement - Meridian.md": "...",
		"Fellowships/Materials/Statement of purpose.docx": "",
		"Fellowships/Materials/budget.xlsx": "",
		"Fellowships/Materials/Writing sample - thesis chapter.pdf": "",
		"Fellowships/Materials/Notes on applying.md": "nothing",
		"Fellowships/Materials/Old/Resume 2024.pdf": "",
		"Elsewhere/Research statement.md": "outside the folder",
	});
}

describe("material categories", () => {
	it("recognises each kind by keywords and leaves the rest as other", () => {
		expect(materialCategory("CV (2 pages maximum)")).toBe("cv");
		expect(materialCategory("Résumé")).toBe("cv");
		expect(materialCategory("Unofficial transcripts from all institutions")).toBe("transcript");
		expect(materialCategory("Personal statement")).toBe("personal-statement");
		expect(materialCategory("Statement of purpose")).toBe("personal-statement");
		expect(materialCategory("one-page motivation letter")).toBe("personal-statement");
		expect(materialCategory("Research statement (3 pages)")).toBe("research-statement");
		expect(materialCategory("Project proposal")).toBe("research-statement");
		expect(materialCategory("Budget justification")).toBe("budget");
		expect(materialCategory("Three letters of recommendation")).toBe("letters");
		expect(materialCategory("Two reference letters")).toBe("letters");
		expect(materialCategory("Writing sample")).toBe("other");
		expect(materialCategory("Conference acceptance notice")).toBe("other");
	});
	it("reads the letters count as a digit or a word", () => {
		expect(lettersCount("Three letters of recommendation")).toBe(3);
		expect(lettersCount("2 reference letters")).toBe(2);
		expect(lettersCount("Letters of recommendation")).toBeNull();
		expect(lettersCount("3 pages of CV")).toBeNull();
	});
});

describe("matching", () => {
	it("pairs each required material with files of its kind in the folder, recursively, and tokens for unknown kinds", () => {
		const files = filesInFolder(vault(), "Fellowships/Materials");
		const matches = matchMaterials(REQUIRED, files);
		expect(matches.map((m) => [m.material, m.files])).toEqual([
			["Personal statement (2 pages)", ["Fellowships/Materials/Personal Statement - Meridian.md", "Fellowships/Materials/Statement of purpose.docx"]],
			["Research statement", []],
			["Unofficial transcripts", ["Fellowships/Materials/Transcript_Fall2026.pdf"]],
			["CV", ["Fellowships/Materials/CV 2026.md", "Fellowships/Materials/Old/Resume 2024.pdf"]],
			["3 letters of recommendation", []],
			["Budget justification", ["Fellowships/Materials/budget.xlsx"]],
			["Writing sample (10 pages)", ["Fellowships/Materials/Writing sample - thesis chapter.pdf"]],
		]);
	});
	it("never lets a file of one kind answer another, and needs every token for unknown kinds", () => {
		const cv = { path: "x/CV.md", basename: "CV", extension: "md", folder: "x" };
		expect(fileMatches("Transcript", "transcript", cv)).toBe(false);
		expect(fileMatches("Writing sample", "other", { path: "x/sample.pdf", basename: "sample", extension: "pdf", folder: "x" })).toBe(false);
		expect(fileMatches("Writing sample", "other", { path: "x/my writing sample.pdf", basename: "my writing sample", extension: "pdf", folder: "x" })).toBe(true);
	});
});

describe("materials section", () => {
	it("ticks found items with links, explains missing ones, reports letters progress, and is idempotent", () => {
		const matches = matchMaterials(REQUIRED, filesInFolder(vault(), "Fellowships/Materials"));
		const section = renderMaterialsSection(matches, "Fellowships/Materials", { received: 1, total: 3 });
		expect(section).toContain("- [x] Personal statement (2 pages) — [[Fellowships/Materials/Personal Statement - Meridian]], [[Fellowships/Materials/Statement of purpose.docx]]");
		expect(section).toContain('- [ ] Research statement — missing: nothing in `Fellowships/Materials` matches "research statement" or "proposal"');
		expect(section).toContain("- [x] Unofficial transcripts — [[Fellowships/Materials/Transcript_Fall2026.pdf]]");
		expect(section).toContain("- [ ] 3 letters of recommendation — 1 of 3 received");
		expect(section).toContain("- [x] Writing sample (10 pages) — [[Fellowships/Materials/Writing sample - thesis chapter.pdf]]");
		expect(renderMaterialsSection(matches, "Fellowships/Materials", { received: 1, total: 3 })).toBe(section);
		expect(materialsProgress(section)).toEqual({ ready: 5, total: 7 });
	});
	it("ticks letters once every expected letter is in and says when no recommender is named", () => {
		const matches = matchMaterials(["2 letters of recommendation"], []);
		expect(renderMaterialsSection(matches, "M", { received: 2, total: 2 })).toBe("- [x] 2 letters of recommendation — 2 of 2 received");
		expect(renderMaterialsSection(matches, "M", { received: 0, total: 0 })).toBe("- [ ] 2 letters of recommendation — no recommenders named yet under Letters");
		expect(renderMaterialsSection([], "M", { received: 0, total: 0 })).toMatch(/^_No required materials/);
		expect(materialsProgress(null)).toEqual({ ready: 0, total: 0 });
	});
});
