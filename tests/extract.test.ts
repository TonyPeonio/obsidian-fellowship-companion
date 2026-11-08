import { describe, expect, it } from "vitest";
import { extractAmount, extractCall, extractDeadlines, extractEligibility, extractMaterials, splitSentences, stripCallPrefix } from "../src/core/extract";
import { TRAVEL_GRANT, US_FELLOWSHIP } from "./fakes";

const TODAY = "2026-11-07";

describe("sentence splitting", () => {
	it("splits after sentence punctuation before a capital, keeping abbreviations and dates whole", () => {
		const s = splitSentences("Applicants must be U.S. citizens. Letters are due Oct. 15, 2026; Late letters are not read. apply now");
		expect(s).toEqual(["Applicants must be U.S. citizens.", "Letters are due Oct. 15, 2026;", "Late letters are not read. apply now"]);
	});
	it("strips bullets and markdown from each sentence", () => {
		expect(splitSentences("- **Must** be enrolled.\n## Eligibility\n1. GPA of 3.0")).toEqual(["Must be enrolled.", "Eligibility", "GPA of 3.0"]);
	});
});

describe("deadlines", () => {
	it("tells the letters deadline from the application deadline when both appear", () => {
		const r = extractCall(US_FELLOWSHIP, TODAY);
		expect(r.deadline).toBe("2026-10-15");
		expect(r.lettersDeadline).toBe("2026-10-22");
	});
	it("reads a day-first deadline and leaves the letters deadline empty when none is stated", () => {
		const r = extractCall(TRAVEL_GRANT, TODAY);
		expect(r.deadline).toBe("2026-12-01");
		expect(r.lettersDeadline).toBeNull();
	});
	it("dates both when applications and letters share one due sentence", () => {
		const r = extractDeadlines(splitSentences("Applications and letters of recommendation are due November 1, 2026."), TODAY);
		expect(r).toEqual({ deadline: "2026-11-01", lettersDeadline: "2026-11-01" });
	});
	it("ignores notification, start and award dates and vague wording", () => {
		const r = extractDeadlines(splitSentences("Awards will be announced by March 1, 2027. The fellowship begins September 1, 2027. Applications are accepted on a rolling basis."), TODAY);
		expect(r).toEqual({ deadline: null, lettersDeadline: null });
	});
	it("prefers strong deadline wording over a bare 'by'", () => {
		const r = extractDeadlines(splitSentences("Register your interest by 2026-11-20. Deadline: 12/15/2026."), TODAY);
		expect(r.deadline).toBe("2026-12-15");
	});
	it("takes the date after the keyword when a sentence opens and closes a window", () => {
		const r = extractDeadlines(splitSentences("The portal opens September 1, 2026 and closes December 1, 2026 at noon."), TODAY);
		expect(r.deadline).toBe("2026-12-01");
	});
});

describe("amounts", () => {
	it("reads stipends with a period and euro amounts per month", () => {
		expect(extractAmount(splitSentences("Fellows receive an annual stipend of $38,000 per year for three years."))).toBe("$38,000 per year");
		expect(extractAmount(splitSentences("The grant provides up to €1,500/month for stays of one to three months."))).toBe("up to €1,500/month");
	});
	it("reads currency codes, k suffixes and 'up to' caps, and skips fees and small amounts", () => {
		expect(extractAmount(splitSentences("Awards of up to 5,000 USD are made."))).toBe("up to 5,000 USD");
		expect(extractAmount(splitSentences("A £2k travel allowance is included."))).toBe("£2k");
		expect(extractAmount(splitSentences("There is a $50 application fee. The award is $1,000."))).toBe("$1,000");
		expect(extractAmount(splitSentences("Submit 3 copies of a 2 page statement."))).toBeNull();
	});
	it("ignores the cost-of-education allowance when the stipend comes first", () => {
		expect(extractCall(US_FELLOWSHIP, TODAY).amount).toBe("$38,000 per year");
	});
});

describe("eligibility", () => {
	it("takes the Eligibility block in order and nothing from the materials list", () => {
		const e = extractCall(US_FELLOWSHIP, TODAY).eligibility;
		expect(e).toEqual([
			"Applicants must be U.S. citizens, U.S. nationals or permanent residents.",
			"Applicants must be enrolled as seniors (final-year undergraduates) or first-year graduate students at an accredited U.S. institution at the time of application.",
			"A minimum cumulative GPA of 3.5 on a 4.0 scale is required.",
			"Eligible fields: physics, chemistry, materials science, and all engineering disciplines.",
		]);
	});
	it("finds eligibility sentences outside a block by their wording", () => {
		const e = extractEligibility([], splitSentences("Submit a CV and a transcript. Applicants must be enrolled full-time. The award is open to students in any field. Letters must be uploaded by the recommender."));
		expect(e).toEqual(["Applicants must be enrolled full-time.", "The award is open to students in any field."]);
	});
	it("reads a 'Who can apply' block", () => {
		const e = extractCall(TRAVEL_GRANT, TODAY).eligibility;
		expect(e[0]).toMatch(/^Students enrolled at a European university/);
		expect(e[1]).toMatch(/^Applicants must be under 30 years of age/);
	});
});

describe("materials", () => {
	it("labels every kind in order of first mention with the letters count", () => {
		const r = extractCall(US_FELLOWSHIP, TODAY);
		expect(r.materials).toEqual(["Personal statement", "Research statement", "Transcript", "CV", "3 letters of recommendation"]);
		expect(r.lettersCount).toBe(3);
	});
	it("skips negated mentions and keeps unknown bullets of a materials block verbatim", () => {
		const r = extractCall(TRAVEL_GRANT, TODAY);
		expect(r.materials).toEqual(["CV", "Personal statement", "Budget"]);
		expect(r.lettersCount).toBeNull();
		const text = "Required documents:\n- Writing sample (10 pages)\n- Two reference letters\n- Resume\n\nDeadline: 2026-12-01";
		expect(extractMaterials(text.split("\n"), splitSentences(text))).toEqual(["2 letters of recommendation", "CV", "Writing sample (10 pages)"]);
	});
});

describe("name, funder and url", () => {
	it("reads the funder from 'Offered by the …' and from a label line", () => {
		expect(extractCall(US_FELLOWSHIP, TODAY).funder).toBe("Meridian Science Foundation");
		expect(extractCall(TRAVEL_GRANT, TODAY).funder).toBe("Nordlicht Foundation for Early-Career Researchers");
	});
	it("guesses the name from the first line without a 'Call for applications' prefix, or from a label", () => {
		expect(extractCall(US_FELLOWSHIP, TODAY).titleGuess).toBe("Meridian Graduate Research Fellowship 2027");
		expect(extractCall(TRAVEL_GRANT, TODAY).titleGuess).toBe("Nordlicht Student Travel Grant");
		expect(stripCallPrefix("Call for applications:")).toBe("Call for applications:");
		expect(extractCall("Program: Carr Summer Scholars\nFunder: Carr Lab\nDeadline Dec 1", TODAY).name).toBe("Carr Summer Scholars");
	});
	it("finds the first URL in the text", () => {
		expect(extractCall(US_FELLOWSHIP, TODAY).url).toBe("https://meridian-sf.example/grf");
		expect(extractCall(TRAVEL_GRANT, TODAY).url).toBeNull();
	});
});
