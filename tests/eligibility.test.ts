import { describe, expect, it } from "vitest";
import { gpaThreshold, groundedCriteria, mergeScreening, parseProfile, parseScreening, precheck, renderScreening, screeningSystemPrompt, screeningUserMessage, type Profile } from "../src/core/eligibility";
import { US_FELLOWSHIP } from "./fakes";

const PROFILE_MD = `---
citizenship: United States
gpa: 3.8
---
# Profile

- **Degree:** BS Physics (undergraduate)
- Year: junior
Field: physics and materials science
Age: 21
Institution: Colorado School of Mines
`;

const profile = parseProfile(PROFILE_MD);
const CRITERIA = [
	"Applicants must be U.S. citizens, U.S. nationals or permanent residents.",
	"Applicants must be enrolled as seniors (final-year undergraduates) or first-year graduate students at an accredited U.S. institution at the time of application.",
	"A minimum cumulative GPA of 3.5 on a 4.0 scale is required.",
	"Eligible fields: physics, chemistry, materials science, and all engineering disciplines.",
];

describe("profile", () => {
	it("reads frontmatter and body lines in several shapes", () => {
		expect(profile).toMatchObject({ citizenship: "United States", gpa: 3.8, degree: "BS Physics (undergraduate)", year: "junior", field: "physics and materials science", age: 21, institution: "Colorado School of Mines" });
		expect(profile.fields.year).toBe("junior");
		expect(parseProfile("nothing here").gpa).toBeNull();
	});
});

describe("deterministic pre-check", () => {
	it("compares GPA against the threshold, ignoring the scale", () => {
		expect(gpaThreshold("A minimum cumulative GPA of 3.5 on a 4.0 scale is required.")).toBe(3.5);
		expect(gpaThreshold("GPA of at least 3.0 (4.0 scale)")).toBe(3.0);
		expect(gpaThreshold("Three letters are required.")).toBeNull();
		expect(precheck(CRITERIA[2], profile)).toMatchObject({ verdict: "likely eligible", source: "rule" });
		expect(precheck(CRITERIA[2], { ...profile, gpa: 3.2 })).toMatchObject({ verdict: "not eligible", reason: "GPA 3.2 is below the 3.5 minimum" });
		expect(precheck(CRITERIA[2], { ...profile, gpa: null })!.verdict).toBe("check");
	});
	it("decides citizenship for U.S. requirements, open calls and other countries", () => {
		expect(precheck(CRITERIA[0], profile)!.verdict).toBe("likely eligible");
		expect(precheck(CRITERIA[0], { ...profile, citizenship: "Canada" })).toMatchObject({ verdict: "not eligible" });
		expect(precheck(CRITERIA[0], { ...profile, citizenship: "Canada (US permanent resident)" })!.verdict).toBe("likely eligible");
		expect(precheck("Students of any nationality may apply.", { ...profile, citizenship: "Canada" })!.verdict).toBe("likely eligible");
		expect(precheck("Applicants must be citizens of Germany.", { ...profile, citizenship: "Germany" })!.verdict).toBe("likely eligible");
		expect(precheck("Applicants must be citizens of Germany.", { ...profile, citizenship: "" })!.verdict).toBe("check");
	});
	it("checks year of study and degree level, treating a held degree as something to check", () => {
		// Junior vs seniors or first-year graduate students: wrong year, right level → not eligible overall.
		expect(precheck(CRITERIA[1], profile)!.verdict).toBe("not eligible");
		expect(precheck(CRITERIA[1], { ...profile, year: "senior" })!.verdict).toBe("likely eligible");
		expect(precheck("Open to graduate students only.", profile)).toMatchObject({ verdict: "not eligible" });
		expect(precheck("Open to undergraduate and graduate students.", profile)!.verdict).toBe("likely eligible");
		expect(precheck("Applicants must hold a bachelor's degree by September 2027.", profile)!.verdict).toBe("check");
		expect(precheck("Sophomores and juniors may apply.", profile)!.verdict).toBe("likely eligible");
	});
	it("applies age limits and field lists", () => {
		expect(precheck("Applicants must be under 30 years of age at the time of application.", profile)!.verdict).toBe("likely eligible");
		expect(precheck("Applicants must be under 30 years of age at the time of application.", { ...profile, age: 31 })).toMatchObject({ verdict: "not eligible" });
		expect(precheck("Applicants must be under 30 years of age.", { ...profile, age: null })!.verdict).toBe("check");
		expect(precheck(CRITERIA[3], profile)!.verdict).toBe("likely eligible");
		expect(precheck("Open to students in any STEM field.", { ...profile, field: "chemistry" })!.verdict).toBe("likely eligible");
		expect(precheck("Eligible fields: history and philosophy.", profile)!.verdict).toBe("check");
	});
	it("returns null when no rule applies", () => {
		expect(precheck("Applicants must present a first-author poster or talk.", profile)).toBeNull();
		expect(precheck("Previous fellows may not reapply.", profile)).toBeNull();
	});
});

describe("grounding", () => {
	it("keeps only criteria that appear in the call text", () => {
		const { kept, dropped } = groundedCriteria([...CRITERIA, "Must be left-handed.", CRITERIA[0]], US_FELLOWSHIP);
		expect(kept).toEqual(CRITERIA);
		expect(dropped).toBe(1);
		expect(groundedCriteria(["Anything"], "")).toEqual({ kept: ["Anything"], dropped: 0 });
	});
});

describe("model screening", () => {
	it("numbers the criteria and lists the profile facts in the prompt", () => {
		const msg = screeningUserMessage(CRITERIA, profile);
		expect(msg).toContain("- citizenship: United States");
		expect(msg).toContain("- gpa: 3.8");
		expect(msg).toContain(`1. ${CRITERIA[0]}`);
		expect(msg).toContain(`4. ${CRITERIA[3]}`);
		expect(screeningSystemPrompt()).toContain('"verdict"');
	});
	it("validates indexes, verdicts and reasons, first result per index winning", () => {
		const reply = '{"results": [{"index": 1, "verdict": "Likely Eligible", "reason": "US citizen"}, {"index": 1, "verdict": "check", "reason": "dup"}, {"index": 9, "verdict": "check", "reason": "out of range"}, {"index": "2", "verdict": "maybe", "reason": "bad verdict"}, {"index": 4, "verdict": "not eligible", "reason": "x"}]}';
		const parsed = parseScreening(reply, CRITERIA)!;
		expect(Array.from(parsed.entries())).toEqual([
			[1, { verdict: "likely eligible", reason: "US citizen" }],
			[4, { verdict: "not eligible", reason: "x" }],
		]);
		expect(parseScreening("garbage", CRITERIA)).toBeNull();
	});
	it("lets rules win over the model and marks the rest as check", () => {
		const criteria = [...CRITERIA, "Must present a first-author poster.", "Previous fellows may not reapply."];
		const model = new Map<number, { verdict: "likely eligible" | "check" | "not eligible"; reason: string }>([
			[3, { verdict: "not eligible", reason: "model is wrong about the GPA" }],
			[5, { verdict: "likely eligible", reason: "profile lists a first-author poster" }],
		]);
		const results = mergeScreening(criteria, profile, model);
		expect(results.map((r) => [r.verdict, r.source])).toEqual([
			["likely eligible", "rule"],
			["not eligible", "rule"],
			["likely eligible", "rule"],
			["likely eligible", "rule"],
			["likely eligible", "model"],
			["check", "none"],
		]);
		expect(results[5].reason).toBe("the model gave no verdict");
		expect(mergeScreening(["Previous fellows may not reapply."], profile, null)[0].reason).toMatch(/run with Ollama reachable/);
	});
	it("renders a summary line and one quoted criterion per line", () => {
		const text = renderScreening(mergeScreening(CRITERIA, profile, null), { today: "2026-11-07", profilePath: "Profile.md", model: null, dropped: 1 });
		expect(text).toContain("_Screened 2026-11-07 against [[Profile]] using deterministic rules only. 3 likely eligible, 0 to check, 1 not eligible. 1 listed criterion was skipped because they do not appear in the call text._");
		expect(text).toContain(`- **likely eligible** — "${CRITERIA[0]}" — profile citizenship "United States" matches the U.S. requirement _(rule)_`);
		expect(text).toContain(`- **not eligible** — "${CRITERIA[1]}" —`);
		const empty: Profile = { citizenship: "", degree: "", year: "", gpa: null, field: "", age: null, institution: "", fields: {} };
		expect(renderScreening([], { today: "2026-11-07", profilePath: "P.md", model: "qwen3.5:9b", dropped: 0 })).toContain("_No criteria to screen.");
		expect(mergeScreening([CRITERIA[2]], empty, null)[0].verdict).toBe("check");
	});
});
