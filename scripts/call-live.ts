// Live check of the model paths against a real Ollama model: two realistic calls go through the
// plugin's own regex pass, extraction prompt, client, JSON validation and merge; the US call also
// runs the letters-guidance prompt and the eligibility screen against a sample profile. Results
// are checked against what the calls actually say (dates above all). Four model calls in total.
//
//   npm run call:live                  # 4 model calls
//   MODEL=qwen3.5:4b npm run call:live
//
import { mkdirSync, writeFileSync } from "fs";
import * as path from "path";
import { extractionSystemPrompt, extractionUserMessage, mergeCall, parseJsonReply, validateModelCall, type CallFields } from "../src/core/call";
import { today } from "../src/core/dates";
import { groundedCriteria, mergeScreening, parseProfile, parseScreening, screeningSystemPrompt, screeningUserMessage } from "../src/core/eligibility";
import { extractCall, splitSentences } from "../src/core/extract";
import { guidanceSystemPrompt, guidanceUserMessage, lettersGuidance, parseGuidance } from "../src/core/letters";
import { OllamaClient } from "../src/core/ollama";

const MODEL = process.env.MODEL ?? "qwen3.5:9b";
const URL = process.env.OLLAMA_URL ?? "http://localhost:11434";
const NUM_CTX = 16384;
// The bundle lives in .e2e/, so prompts and replies land in .e2e/call-live-out/ (git-ignored).
const OUT_DIR = path.join(__dirname, "call-live-out");

interface Sample {
	name: string;
	text: string;
	expect: Partial<Record<keyof CallFields, unknown>> & { materialsAtLeast: number; eligibilityAtLeast: number; keywordsAtLeast: number };
	letters: boolean;
}

const samples: Sample[] = [
	{
		name: "US graduate fellowship (two deadlines, letters, GPA and citizenship rules)",
		letters: true,
		text: `Meridian Graduate Research Fellowship 2027
Offered by the Meridian Science Foundation

The Meridian Graduate Research Fellowship supports outstanding students beginning research-based graduate study in the physical sciences and engineering. Fellows receive an annual stipend of $38,000 per year for three years plus a $12,000 cost-of-education allowance paid to the institution.

Eligibility
- Applicants must be U.S. citizens, U.S. nationals or permanent residents.
- Applicants must be enrolled as seniors (final-year undergraduates) or first-year graduate students at an accredited U.S. institution at the time of application.
- A minimum cumulative GPA of 3.5 on a 4.0 scale is required.
- Eligible fields: physics, chemistry, materials science, and all engineering disciplines.

Application materials
- Personal statement (2 pages)
- Research statement (3 pages)
- Unofficial transcripts from all institutions attended
- CV (2 pages maximum)
- Three letters of recommendation

Letters should address the applicant's research potential, independence and ability to communicate scientific results. Recommenders should know the applicant's work directly.

Application deadline: October 15, 2026 at 5:00 pm Eastern. Reference letters are due October 22, 2026. Awards will be announced in March 2027.
Questions: fellowships@meridian-sf.example. Apply at https://meridian-sf.example/grf`,
		expect: { funder: "Meridian Science Foundation", amount: "$38,000 per year", deadline: "2026-10-15", lettersDeadline: "2026-10-22", lettersCount: 3, materialsAtLeast: 5, eligibilityAtLeast: 4, keywordsAtLeast: 3 },
	},
	{
		name: "European travel grant (euro per month, day-first deadline, no letters)",
		letters: false,
		text: `Call for applications: Nordlicht Student Travel Grant
Funder: Nordlicht Foundation for Early-Career Researchers

The Nordlicht Student Travel Grant covers travel and subsistence for undergraduate and master's students presenting a first-author poster or talk at an international conference in Europe. The grant provides up to €1,500/month for stays of one to three months, or a single payment of €800 for conference attendance of under a week.

Who can apply
Students enrolled at a European university in any field of the natural sciences, of any nationality. Applicants must be under 30 years of age at the time of application and in good academic standing.

How to apply
Submit a CV, a one-page motivation letter, a budget (travel, accommodation, registration) and the conference acceptance notice through the portal. No letters of recommendation are required.

Applications close on 1 December 2026. Decisions are sent within six weeks.`,
		expect: { funder: "Nordlicht Foundation for Early-Career Researchers", amount: "up to €1,500/month", deadline: "2026-12-01", lettersDeadline: null, lettersCount: 0, materialsAtLeast: 3, eligibilityAtLeast: 2, keywordsAtLeast: 2 },
	},
];

const PROFILE = `---
citizenship: United States
gpa: 3.8
---
- Degree: BS Physics (undergraduate)
- Year: senior
- Field: physics
- Age: 22
- Institution: Colorado School of Mines
`;

function fail(msg: string): never {
	console.error(`FAIL: ${msg}`);
	process.exit(1);
}

function slug(s: string): string {
	return s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "");
}

async function chat(client: OllamaClient, system: string, user: string, outName: string): Promise<{ reply: string; secs: string }> {
	const t0 = Date.now();
	const reply = await client.chat({
		model: MODEL,
		messages: [
			{ role: "system", content: system },
			{ role: "user", content: user },
		],
		options: { num_ctx: NUM_CTX, temperature: 0.1, top_p: 0.9, top_k: 20 },
		keep_alive: "10m",
		think: false,
		format: "json",
	});
	writeFileSync(path.join(OUT_DIR, `${outName}.txt`), `--- system ---\n${system}\n\n--- user ---\n${user}\n\n--- reply ---\n${reply}\n`);
	return { reply, secs: ((Date.now() - t0) / 1000).toFixed(1) };
}

async function main() {
	mkdirSync(OUT_DIR, { recursive: true });
	const client = new OllamaClient(() => URL);
	console.log(`Ollama ${await client.version()} at ${URL}, model ${MODEL}, today ${today()}\n`);
	let problems = 0;
	const check = (name: string, ok: boolean, detail: unknown) => {
		if (!ok) problems++;
		console.log(`  ${ok ? "ok  " : "FAIL"} ${name} — ${typeof detail === "string" ? detail : JSON.stringify(detail)}`);
	};
	for (const sample of samples) {
		const date = today();
		const regex = extractCall(sample.text, date);
		const { reply, secs } = await chat(client, extractionSystemPrompt(), extractionUserMessage(sample.text), `extract-${slug(sample.name)}`);
		const json = parseJsonReply(reply);
		console.log(`== ${sample.name} · ${secs}s · ${reply.length} chars · JSON ${json ? "parsed" : "NOT PARSED"}`);
		if (!json) {
			problems++;
			console.log(reply.slice(0, 500));
			continue;
		}
		const model = validateModelCall(json, date);
		console.log("regex :", JSON.stringify(regex));
		console.log("model :", JSON.stringify(model));
		const merged = mergeCall(regex, model);
		console.log("merged:", JSON.stringify(merged, null, 1));
		check("model deadline parses to the right day", model.deadline === sample.expect.deadline, `model ${model.deadline} vs ${sample.expect.deadline}`);
		check("model letters deadline", model.lettersDeadline === sample.expect.lettersDeadline, `model ${model.lettersDeadline} vs ${sample.expect.lettersDeadline}`);
		check("merged deadline", merged.deadline === sample.expect.deadline, merged.deadline);
		check("merged letters deadline", merged.lettersDeadline === sample.expect.lettersDeadline, merged.lettersDeadline);
		check("merged amount", merged.amount === sample.expect.amount, merged.amount);
		check("merged funder", merged.funder === sample.expect.funder, merged.funder);
		check("name non-empty and not the placeholder", merged.name !== "Untitled opportunity" && /fellowship|grant/i.test(merged.name), merged.name);
		check("letters count", merged.lettersCount === sample.expect.lettersCount, merged.lettersCount);
		check(`at least ${sample.expect.materialsAtLeast} materials`, merged.materials.length >= sample.expect.materialsAtLeast, merged.materials);
		check("no duplicate material kinds", new Set(merged.materials.map((m) => m.toLowerCase())).size === merged.materials.length, merged.materials.length);
		check(`at least ${sample.expect.eligibilityAtLeast} eligibility lines`, merged.eligibility.length >= sample.expect.eligibilityAtLeast, merged.eligibility.length);
		check(`at least ${sample.expect.keywordsAtLeast} keywords`, merged.keywords.length >= sample.expect.keywordsAtLeast, merged.keywords);

		if (sample.letters) {
			const det = lettersGuidance(splitSentences(sample.text));
			const g = await chat(client, guidanceSystemPrompt(), guidanceUserMessage(sample.text), `guidance-${slug(sample.name)}`);
			const points = parseGuidance(g.reply, sample.text);
			console.log(`-- letters guidance · ${g.secs}s · deterministic: ${JSON.stringify(det)} · model: ${JSON.stringify(points)}`);
			check("deterministic guidance found the two sentences", det.length === 2, det.length);
			check("model guidance parsed with at least one grounded point", points !== null && points.length >= 1, points);
			check("grounded points mention research potential or communication", (points ?? []).some((p) => /research|communicat|independen/i.test(p)), points);

			const profile = parseProfile(PROFILE);
			const { kept } = groundedCriteria(merged.eligibility, sample.text);
			const s = await chat(client, screeningSystemPrompt(), screeningUserMessage(kept, profile), `screen-${slug(sample.name)}`);
			const parsed = parseScreening(s.reply, kept);
			const results = mergeScreening(kept, profile, parsed);
			console.log(`-- eligibility screen · ${s.secs}s · ${kept.length} criteria · model results ${parsed ? parsed.size : "NOT PARSED"}`);
			for (const r of results) console.log(`   ${r.verdict} [${r.source}] — ${r.criterion.slice(0, 70)}… — ${r.reason}`);
			check("screen reply parsed", parsed !== null, parsed?.size);
			check("GPA, citizenship, year and field decided by rules", results.filter((r) => r.source === "rule").length >= 3, results.map((r) => r.source));
			check("senior US physics student with 3.8 GPA is likely eligible on every rule", results.filter((r) => r.source === "rule").every((r) => r.verdict === "likely eligible"), results.filter((r) => r.source === "rule").map((r) => r.verdict));
		}
		console.log();
	}
	console.log(problems === 0 ? "All checks passed." : `${problems} check(s) failed.`);
	process.exit(problems === 0 ? 0 : 1);
}

main().catch((err) => fail((err as Error).stack ?? String(err)));
