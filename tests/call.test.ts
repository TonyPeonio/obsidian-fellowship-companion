import { describe, expect, it } from "vitest";
import { emptyModelCall, extractionSystemPrompt, extractionUserMessage, mergeCall, parseJsonReply, validateModelCall } from "../src/core/call";
import { extractCall } from "../src/core/extract";
import { TRAVEL_GRANT, US_FELLOWSHIP } from "./fakes";

const TODAY = "2026-11-07";

describe("model JSON parsing", () => {
	it("finds the object inside fences, prose and think blocks, and handles braces in strings", () => {
		expect(parseJsonReply('<think>hmm</think>Sure! ```json\n{"name": "GRF", "funder": "NSF"}\n```\nDone.')).toEqual({ name: "GRF", funder: "NSF" });
		expect(parseJsonReply('{"name": "Award {A}", "x": "}"}')).toEqual({ name: "Award {A}", x: "}" });
	});
	it("returns null for non-JSON, arrays and truncated objects", () => {
		expect(parseJsonReply("no json here")).toBeNull();
		expect(parseJsonReply("[1,2]")).toBeNull();
		expect(parseJsonReply('{"a": ')).toBeNull();
	});
});

describe("model output validation", () => {
	it("coerces types, re-parses dates deterministically, caps lists and lowercases keywords", () => {
		const v = validateModelCall(
			{
				name: "  Meridian  Fellowship ",
				funder: 42,
				amount: "$38,000 per year",
				deadline: "October 15, 2026",
				letters_deadline: "22 Oct 2026",
				eligibility: Array.from({ length: 15 }, (_, i) => `rule ${i}`),
				materials: ["CV", "cv", "", 7, "Transcript"],
				letters_count: "3",
				keywords: ["Physics", "Materials Science", "physics"],
			},
			TODAY,
		);
		expect(v.name).toBe("Meridian Fellowship");
		expect(v.funder).toBeNull();
		expect(v.deadline).toBe("2026-10-15");
		expect(v.lettersDeadline).toBe("2026-10-22");
		expect(v.eligibility).toHaveLength(12);
		expect(v.materials).toEqual(["CV", "Transcript"]);
		expect(v.lettersCount).toBe(3);
		expect(v.keywords).toEqual(["physics", "materials science"]);
	});
	it("turns vague or absurd values into null", () => {
		const v = validateModelCall({ deadline: "rolling", letters_count: 99, keywords: "physics" }, TODAY);
		expect(v.deadline).toBeNull();
		expect(v.lettersCount).toBeNull();
		expect(v.keywords).toEqual([]);
		expect(validateModelCall(null, TODAY)).toEqual(emptyModelCall());
	});
});

describe("merge", () => {
	it("lets regex facts win and the model fill the gaps", () => {
		const regex = extractCall(US_FELLOWSHIP, TODAY);
		const model = { ...emptyModelCall(), name: "Meridian Graduate Research Fellowship", funder: "Wrong Funder", amount: "$50,000", deadline: "2026-01-01", lettersDeadline: null, keywords: ["physics", "engineering"] };
		const merged = mergeCall(regex, model);
		expect(merged.name).toBe("Meridian Graduate Research Fellowship");
		expect(merged.funder).toBe("Meridian Science Foundation");
		expect(merged.amount).toBe("$38,000 per year");
		expect(merged.deadline).toBe("2026-10-15");
		expect(merged.lettersDeadline).toBe("2026-10-22");
		expect(merged.keywords).toEqual(["physics", "engineering"]);
		expect(merged.lettersCount).toBe(3);
	});
	it("adds model eligibility and materials that say something new, dropping duplicates by kind", () => {
		const regex = extractCall(TRAVEL_GRANT, TODAY);
		const model = { ...emptyModelCall(), eligibility: ["Students enrolled at a European university in any field of the natural sciences, of any nationality", "Must present a first-author poster or talk"], materials: ["Curriculum vitae", "Motivation letter (one page)", "Conference acceptance notice", "Budget"], lettersCount: 2 };
		const merged = mergeCall(regex, model);
		expect(merged.eligibility).toHaveLength(3);
		expect(merged.eligibility[2]).toBe("Must present a first-author poster or talk");
		expect(merged.materials).toEqual(["CV", "Personal statement", "Budget", "Conference acceptance notice"]);
		expect(merged.lettersCount).toBe(2);
	});
	it("falls back to the first line for the name and to placeholders when nothing is known", () => {
		const merged = mergeCall(extractCall("Some Opportunity\nA short description with no facts at all.", TODAY), emptyModelCall());
		expect(merged.name).toBe("Some Opportunity");
		expect(merged.funder).toBe("Unknown funder");
		expect(merged.deadline).toBeNull();
		expect(merged.lettersCount).toBe(0);
	});
});

describe("prompt", () => {
	it("asks for every schema key and forbids inventing", () => {
		const p = extractionSystemPrompt();
		for (const key of ["name", "funder", "amount", "deadline", "letters_deadline", "eligibility", "materials", "letters_count", "keywords"]) expect(p).toContain(`"${key}"`);
		expect(p).toMatch(/Never invent/);
		expect(extractionUserMessage("  text  ")).toBe("Call for applications:\n\ntext\n\nReturn the JSON object now.");
	});
});
