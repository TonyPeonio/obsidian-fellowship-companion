import { describe, expect, it } from "vitest";
import { splitSentences } from "../src/core/extract";
import { guidanceSystemPrompt, letterFileName, lettersGuidance, parseGuidance, renderLetterRequest, type LetterRequestInput } from "../src/core/letters";
import { namedLetters, parseFellowshipNote, renderFellowshipNote, setLetterDate } from "../src/core/note";
import { materialCategory } from "../src/core/materials";
import { writeNote } from "../src/core/vault";
import { FakeVault, TRAVEL_GRANT, US_FELLOWSHIP } from "./fakes";
import { sampleInput } from "./note.test";

const TODAY = "2026-11-07";

describe("what letters should address", () => {
	it("copies the sentences of the call that tell recommenders what to cover", () => {
		expect(lettersGuidance(splitSentences(US_FELLOWSHIP))).toEqual(["Letters should address the applicant's research potential, independence and ability to communicate scientific results.", "Recommenders should know the applicant's work directly."]);
		expect(lettersGuidance(splitSentences(TRAVEL_GRANT))).toEqual([]);
	});
	it("keeps model points only when they are grounded in the call text", () => {
		const reply = '{"points": ["Research potential and independence", "Ability to communicate scientific results", "Leadership of a student society and fundraising record", ""]}';
		expect(parseGuidance(reply, US_FELLOWSHIP)).toEqual(["Research potential and independence", "Ability to communicate scientific results"]);
		expect(parseGuidance("not json", US_FELLOWSHIP)).toBeNull();
		expect(parseGuidance('{"points": "x"}', US_FELLOWSHIP)).toEqual([]);
		expect(guidanceSystemPrompt()).toContain('"points"');
	});
});

function request(overrides: Partial<LetterRequestInput> = {}): LetterRequestInput {
	return {
		recommender: "Prof. Carr",
		name: "Meridian Graduate Research Fellowship 2027",
		funder: "Meridian Science Foundation",
		amount: "$38,000 per year",
		deadline: "2026-10-15",
		lettersDeadline: "2026-10-22",
		url: "https://meridian-sf.example/grf",
		notePath: "Fellowships/Meridian Science Foundation - Meridian Graduate Research Fellowship 2027.md",
		guidance: ["Letters should address the applicant's research potential."],
		guidanceSource: "call",
		materials: ["Personal statement", "Research statement", "Transcript", "CV"],
		today: TODAY,
		...overrides,
	};
}

describe("letter request note", () => {
	it("renders the summary, the letters deadline, guidance, materials and a draft message that is never sent", () => {
		const text = renderLetterRequest(request());
		expect(text).toContain("recommender: Prof. Carr");
		expect(text).toContain("asked_on: 2026-11-07");
		expect(text).toContain("# Letter request: Prof. Carr — Meridian Graduate Research Fellowship 2027");
		expect(text).toContain("- **Letters due:** 2026-10-22");
		expect(text).toContain("- **Note:** [[Fellowships/Meridian Science Foundation - Meridian Graduate Research Fellowship 2027]]");
		expect(text).toContain("## What the letter should address\n\n- Letters should address the applicant's research potential.\n\n_Sentences copied from the call._");
		expect(text).toContain("## Materials I will attach\n\n- Personal statement\n- Research statement\n- Transcript\n- CV");
		expect(text).toContain("Dear Prof. Carr,");
		expect(text).toContain("Letters are due 2026-10-22.");
		expect(text).toContain("nothing is sent automatically");
	});
	it("falls back to the application deadline and says so when the call has no letters deadline or guidance", () => {
		const text = renderLetterRequest(request({ lettersDeadline: null, guidance: [], guidanceSource: "none", materials: [] }));
		expect(text).toContain("- **Letters due:** 2026-10-15 (the application deadline; the call states no separate letters deadline)");
		expect(text).toContain("_The call does not say what letters should address.");
		expect(text).toContain("- _(nothing listed; add what you will send)_");
		expect(text).toContain("Letters are due 2026-10-15.");
	});
	it("marks model-sourced guidance and builds a safe file name", () => {
		expect(renderLetterRequest(request({ guidanceSource: "model" }))).toContain("summarised from the call by the local model");
		expect(letterFileName("Dr. A. Carr", "GRFP: 2027")).toBe("Dr. A. Carr - GRFP 2027.md");
	});
});

describe("drafting flow", () => {
	it("drafts one note per named recommender without an asked-on date, then has nothing left to do", async () => {
		const vault = new FakeVault();
		const notePath = "Fellowships/Meridian - GRF.md";
		let content = renderFellowshipNote(sampleInput());
		content = content.replace("|  |  |  |\n|  |  |  |\n|  |  |  |", "| Prof. Carr |  |  |\n| Dr. Lee | 2026-11-01 |  |\n|  |  |  |");
		await writeNote(vault, notePath, content);

		const draft = async () => {
			const note = parseFellowshipNote(await vault.read(notePath))!;
			const pending = namedLetters(note.letters).filter((r) => r.askedOn === "");
			const written: string[] = [];
			for (const row of pending) {
				const path = `Fellowships/Letters/${letterFileName(row.recommender, note.name)}`;
				if (!vault.exists(path)) {
					await vault.create(path, renderLetterRequest(request({ recommender: row.recommender, materials: note.materials.filter((m) => materialCategory(m) !== "letters") })));
					written.push(row.recommender);
				}
				await vault.modify(notePath, setLetterDate(await vault.read(notePath), row.recommender, "askedOn", TODAY));
			}
			return written;
		};

		expect(await draft()).toEqual(["Prof. Carr"]);
		expect(vault.exists("Fellowships/Letters/Prof. Carr - Meridian Graduate Research Fellowship 2027.md")).toBe(true);
		expect(vault.exists("Fellowships/Letters/Dr. Lee - Meridian Graduate Research Fellowship 2027.md")).toBe(false);
		const after = parseFellowshipNote(await vault.read(notePath))!;
		expect(after.letters).toEqual([
			{ recommender: "Prof. Carr", askedOn: TODAY, receivedOn: "" },
			{ recommender: "Dr. Lee", askedOn: "2026-11-01", receivedOn: "" },
			{ recommender: "", askedOn: "", receivedOn: "" },
		]);
		expect(after.materials).toHaveLength(5);
		const letter = await vault.read("Fellowships/Letters/Prof. Carr - Meridian Graduate Research Fellowship 2027.md");
		expect(letter).not.toContain("letters of recommendation\n");
		// Second run: nothing pending, nothing rewritten.
		const before = await vault.read(notePath);
		expect(await draft()).toEqual([]);
		expect(await vault.read(notePath)).toBe(before);
	});
});
