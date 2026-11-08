import { describe, expect, it } from "vitest";
import { mergeCall, emptyModelCall } from "../src/core/call";
import { extractCall } from "../src/core/extract";
import { fellowshipFileName, isFellowshipNote, namedLetters, parseCallText, parseFellowshipNote, parseLettersTable, renderFellowshipNote, setLetterDate, type FellowshipNoteInput } from "../src/core/note";
import { parseFrontmatter } from "../src/core/frontmatter";
import { applyStatus, nextStatus, isStatus } from "../src/core/status";
import { US_FELLOWSHIP } from "./fakes";

const TODAY = "2026-11-07";

export function sampleInput(overrides: Partial<FellowshipNoteInput> = {}): FellowshipNoteInput {
	const fields = mergeCall(extractCall(US_FELLOWSHIP, TODAY), { ...emptyModelCall(), keywords: ["physics", "materials science"] });
	return { ...fields, url: "https://meridian-sf.example/grf", callText: US_FELLOWSHIP, today: TODAY, ...overrides };
}

describe("fellowship note", () => {
	it("round-trips frontmatter, lists, letters rows and the call text", () => {
		const content = renderFellowshipNote(sampleInput());
		const note = parseFellowshipNote(content)!;
		expect(note).not.toBeNull();
		expect(note.name).toBe("Meridian Graduate Research Fellowship 2027");
		expect(note.funder).toBe("Meridian Science Foundation");
		expect(note.amount).toBe("$38,000 per year");
		expect(note.deadline).toBe("2026-10-15");
		expect(note.lettersDeadline).toBe("2026-10-22");
		expect(note.status).toBe("considering");
		expect(note.submittedOn).toBe("");
		expect(note.eligibility).toHaveLength(4);
		expect(note.materials).toEqual(["Personal statement", "Research statement", "Transcript", "CV", "3 letters of recommendation"]);
		expect(note.url).toBe("https://meridian-sf.example/grf");
		expect(note.keywords).toEqual(["physics", "materials science"]);
		expect(note.letters).toHaveLength(3);
		expect(namedLetters(note.letters)).toHaveLength(0);
		expect(note.callText).toBe(US_FELLOWSHIP.replace(/\s+$/, ""));
		expect(note.timeline).toEqual([{ date: TODAY, text: "added" }]);
		expect(note.materialsChecklist).toEqual({ ready: 0, total: 5 });
	});
	it("writes the sections in the agreed order with checklists and a fence", () => {
		const content = renderFellowshipNote(sampleInput());
		const order = ["## Call", "## Eligibility", "## Materials", "## Letters", "## Timeline", "## Notes"].map((h) => content.indexOf(h));
		expect(order.every((i, n) => i >= 0 && (n === 0 || i > order[n - 1]))).toBe(true);
		expect(content).toContain("- [ ] A minimum cumulative GPA of 3.5 on a 4.0 scale is required.");
		expect(content).toContain("- [ ] 3 letters of recommendation");
		expect(content).toContain("| Recommender | Asked on | Received on |\n|---|---|---|\n|  |  |  |\n|  |  |  |\n|  |  |  |");
		expect(content).toContain("```text\n" + US_FELLOWSHIP.trim());
	});
	it("uses a fence longer than any backtick run in the call so the call cannot close it", () => {
		const content = renderFellowshipNote(sampleInput({ callText: "Call with ```` four backticks ````" }));
		expect(content).toContain("`````text\nCall with ```` four backticks ````\n`````");
		expect(parseCallText(content)).toBe("Call with ```` four backticks ````");
	});
	it("quotes frontmatter values YAML would misread and reads them back", () => {
		const content = renderFellowshipNote(sampleInput({ name: "Fellowship: Phase 2", amount: "" }));
		expect(content).toContain('name: "Fellowship: Phase 2"');
		expect(content).toContain('amount: ""');
		expect(parseFrontmatter(content).data.name).toBe("Fellowship: Phase 2");
	});
	it("builds a safe file name and recognises only its own notes", () => {
		expect(fellowshipFileName("NSF / DGE", "GRFP: 2027 [cycle]")).toBe("NSF DGE - GRFP 2027 cycle.md");
		expect(fellowshipFileName("", "")).toBe("Unknown funder - Untitled opportunity.md");
		expect(isFellowshipNote({ name: "x", funder: "y", status: "considering" })).toBe(true);
		expect(isFellowshipNote({ company: "x", role: "y", status: "wishlist" })).toBe(false);
		expect(parseFellowshipNote("# Not a fellowship\n")).toBeNull();
	});
});

describe("letters table", () => {
	const table = "## Letters\n\n| Recommender | Asked on | Received on |\n|---|---|---|\n| Prof. Carr | 2026-11-01 | |\n| Dr. A \\| B | | |\n|  |  |  |\n\n## Timeline\n";
	it("parses rows with escaped pipes and keeps empty rows as requested letters", () => {
		const rows = parseLettersTable(table);
		expect(rows).toEqual([
			{ recommender: "Prof. Carr", askedOn: "2026-11-01", receivedOn: "" },
			{ recommender: "Dr. A | B", askedOn: "", receivedOn: "" },
			{ recommender: "", askedOn: "", receivedOn: "" },
		]);
		expect(namedLetters(rows).map((r) => r.recommender)).toEqual(["Prof. Carr", "Dr. A | B"]);
	});
	it("sets one date cell in place and leaves the rest of the note alone", () => {
		const out = setLetterDate(table, "dr. a | b", "askedOn", "2026-11-07");
		expect(out).toContain("| Dr. A \\| B | 2026-11-07 |  |");
		expect(out).toContain("| Prof. Carr | 2026-11-01 | |");
		expect(out.replace("| Dr. A \\| B | 2026-11-07 |  |", "| Dr. A \\| B | | |")).toBe(table);
		expect(setLetterDate(table, "Nobody", "receivedOn", "2026-11-07")).toBe(table);
	});
});

describe("status workflow", () => {
	it("moves through the workflow with dated timeline lines and sets submitted_on once", () => {
		let content = renderFellowshipNote(sampleInput());
		content = applyStatus(content, "considering", "preparing", "2026-11-08");
		expect(parseFellowshipNote(content)!.status).toBe("preparing");
		expect(content).toContain("- 2026-11-07 — added\n- 2026-11-08 — preparing");
		content = applyStatus(content, "preparing", "submitted", "2026-11-20");
		let note = parseFellowshipNote(content)!;
		expect(note.status).toBe("submitted");
		expect(note.submittedOn).toBe("2026-11-20");
		content = applyStatus(content, "submitted", "withdrawn", "2026-12-01", note.submittedOn);
		content = applyStatus(content, "withdrawn", "submitted", "2026-12-02", note.submittedOn);
		note = parseFellowshipNote(content)!;
		expect(note.submittedOn).toBe("2026-11-20");
		expect(note.timeline.map((t) => t.text)).toEqual(["added", "preparing", "submitted", "withdrawn", "submitted"]);
		expect(note.materials).toHaveLength(5);
	});
	it("leaves the note unchanged for the same status and knows the workflow order", () => {
		const content = renderFellowshipNote(sampleInput());
		expect(applyStatus(content, "considering", "considering", TODAY)).toBe(content);
		expect(nextStatus("considering")).toBe("preparing");
		expect(nextStatus("awarded")).toBe("declined");
		expect(nextStatus("withdrawn")).toBe("considering");
		expect(isStatus("interview")).toBe(true);
		expect(isStatus("applied")).toBe(false);
	});
});
