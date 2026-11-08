import { describe, expect, it } from "vitest";
import { dueSoon, lettersDueSoon, loadFellowships, renderBoard, type FellowshipRecord } from "../src/core/board";
import { foldLine, renderIcs, uidFor } from "../src/core/ics";
import { renderFellowshipNote, type FellowshipNoteInput } from "../src/core/note";
import { applyStatus } from "../src/core/status";
import { upsertSection } from "../src/core/sections";
import { FakeVault } from "./fakes";

const TODAY = "2026-11-07";

function note(funder: string, name: string, deadline: string | null, lettersDeadline: string | null, added: string, extra: Partial<FellowshipNoteInput> = {}): string {
	return renderFellowshipNote({ name, funder, amount: "", deadline, lettersDeadline, eligibility: [], materials: [], lettersCount: 0, keywords: [], url: "", callText: "call text long enough", today: added, ...extra });
}

function withLetters(content: string, rows: string[]): string {
	return content.replace(/\| Recommender \| Asked on \| Received on \|\n\|---\|---\|---\|(?:\n\|  \|  \|  \|)*/, `| Recommender | Asked on | Received on |\n|---|---|---|\n${rows.join("\n")}`);
}

function vault(): FakeVault {
	// Alpha: due in 8 days, 3 letters (1 received), letters due in 5 days, materials 2 of 3 ready.
	let alpha = note("Alpha Foundation", "Research Fellowship", "2026-11-15", "2026-11-12", "2026-11-01", { materials: ["CV", "Transcript", "3 letters of recommendation"], lettersCount: 3, url: "https://alpha.example/rf" });
	alpha = withLetters(alpha, ["| Prof. Carr | 2026-11-02 | 2026-11-05 |", "| Dr. Lee | 2026-11-02 |  |", "|  |  |  |"]);
	alpha = upsertSection(alpha, "Materials", "- [x] CV — [[M/CV]]\n- [ ] Transcript — missing\n- [x] 3 letters of recommendation — 1 of 3 received");
	// Beta: submitted, so never due; letters complete.
	let beta = note("Beta Trust", "Travel Grant", "2026-11-20", "2026-11-10", "2026-10-01", { materials: ["CV", "2 letters of recommendation"], lettersCount: 2 });
	beta = withLetters(beta, ["| Prof. X | 2026-10-02 | 2026-10-20 |", "| Prof. Y | 2026-10-02 | 2026-10-21 |"]);
	beta = applyStatus(beta, "considering", "preparing", "2026-10-05");
	beta = applyStatus(beta, "preparing", "submitted", "2026-10-25");
	// Gamma: due in 45 days (outside the window), letters due in 20 days (outside), no recommender named yet.
	const gamma = note("Gamma Agency", "Scholarship", "2026-12-22", "2026-11-27", "2026-11-06", { materials: ["Personal statement", "Letters of recommendation"], lettersCount: 2 });
	// Delta: declined, overdue deadline.
	const delta = applyStatus(note("Delta Society", "Prize", "2026-11-05", null, "2026-10-01"), "considering", "declined", "2026-10-12");
	// Epsilon: no deadline at all.
	const epsilon = note("Epsilon Fund", "Open Call", null, null, "2026-11-06");
	return new FakeVault({
		"Fellowships/Alpha Foundation - Research Fellowship.md": alpha,
		"Fellowships/Beta Trust - Travel Grant.md": beta,
		"Fellowships/Gamma Agency - Scholarship.md": gamma,
		"Fellowships/Delta Society - Prize.md": delta,
		"Fellowships/Epsilon Fund - Open Call.md": epsilon,
		"Fellowships/Board.md": "---\nsource: board\n---\n# Board\n",
		"Fellowships/Letters/Prof. Carr - Research Fellowship.md": "---\nrecommender: Prof. Carr\n---\n# Letter request\n",
		"Fellowships/Materials/CV.md": "# CV",
		"Other/Alpha Foundation - Research Fellowship.md": note("Elsewhere", "Ignored", "2026-11-10", null, "2026-11-01"),
	});
}

describe("board", () => {
	it("loads fellowship notes from the folder only, with letters and materials counts", async () => {
		const records = await loadFellowships(vault(), "Fellowships");
		expect(records.map((r) => r.funder).sort()).toEqual(["Alpha Foundation", "Beta Trust", "Delta Society", "Epsilon Fund", "Gamma Agency"]);
		const alpha = records.find((r) => r.funder === "Alpha Foundation")!;
		expect(alpha).toMatchObject({ status: "considering", deadline: "2026-11-15", lettersDeadline: "2026-11-12", lettersReceived: 1, lettersTotal: 3, materialsReady: 2, materialsTotal: 3, open: true, active: true, lastUpdate: "2026-11-01" });
		const beta = records.find((r) => r.funder === "Beta Trust")!;
		expect(beta).toMatchObject({ status: "submitted", lettersReceived: 2, lettersTotal: 2, open: false, active: true, lastUpdate: "2026-10-25" });
		expect(records.find((r) => r.funder === "Gamma Agency")!.lettersTotal).toBe(2);
		expect(records.find((r) => r.funder === "Delta Society")!.active).toBe(false);
	});
	it("lists what is due in 30 days and whose letters are due in 14 days, open opportunities only", async () => {
		const records = await loadFellowships(vault(), "Fellowships");
		expect(dueSoon(records, TODAY).map((r) => r.funder)).toEqual(["Alpha Foundation"]);
		expect(lettersDueSoon(records, TODAY).map((r) => r.funder)).toEqual(["Alpha Foundation"]);
		// Move today forward: Gamma comes into both windows; Alpha's deadline has passed.
		expect(dueSoon(records, "2026-11-25").map((r) => r.funder)).toEqual(["Gamma Agency"]);
		expect(lettersDueSoon(records, "2026-11-20").map((r) => r.funder)).toEqual(["Gamma Agency"]);
	});
	it("renders the due lists and a table per status with days left, letters and materials, deterministically", async () => {
		const records = await loadFellowships(vault(), "Fellowships");
		const board = renderBoard(records, TODAY);
		expect(board).toContain("## Due in 30 days\n\n- 2026-11-15 (8) — [[Fellowships/Alpha Foundation - Research Fellowship|Alpha Foundation — Research Fellowship]] · considering · 1 of 3 received · 2 of 3 ready");
		expect(board).toContain("## Letters due in 14 days\n\n- 2026-11-12 (5) — [[Fellowships/Alpha Foundation - Research Fellowship|Alpha Foundation — Research Fellowship]] · 1 of 3 received");
		expect(board).toContain("## Considering (3)\n\n| Funder | Name | Deadline | Days left | Letters | Materials | Note |\n|---|---|---|---|---|---|---|\n| Alpha Foundation | Research Fellowship | 2026-11-15 | 8 | 1 of 3 received | 2 of 3 ready | [[Fellowships/Alpha Foundation - Research Fellowship\\|open]] |\n| Gamma Agency | Scholarship | 2026-12-22 | 45 | 0 of 2 received | 0 of 2 ready | [[Fellowships/Gamma Agency - Scholarship\\|open]] |\n| Epsilon Fund | Open Call |  |  |  |  | [[Fellowships/Epsilon Fund - Open Call\\|open]] |");
		expect(board).toContain("## Submitted (1)\n\n| Funder | Name | Deadline | Days left | Letters | Materials | Note |\n|---|---|---|---|---|---|---|\n| Beta Trust | Travel Grant | 2026-11-20 | 13 | 2 of 2 received | 0 of 2 ready |");
		expect(board).toContain("## Declined (1)\n\n| Funder | Name | Deadline | Days left | Letters | Materials | Note |\n|---|---|---|---|---|---|---|\n| Delta Society | Prize | 2026-11-05 | overdue (2d) |");
		expect(board).toContain("## Awarded (0)\n\n_None._");
		expect(renderBoard(records, TODAY)).toBe(board);
	});
	it("falls back to the application deadline for letters and escapes pipes", () => {
		const r: FellowshipRecord = { path: "F/x.md", funder: "A | B", name: "N", status: "preparing", amount: "", deadline: "2026-11-10", lettersDeadline: null, lettersReceived: 0, lettersTotal: 2, materialsReady: 0, materialsTotal: 0, lastUpdate: TODAY, url: "", open: true, active: true };
		const board = renderBoard([r], TODAY);
		expect(board).toContain("- 2026-11-10 (3) — [[F/x|A | B — N]] · 0 of 2 received · application deadline (no separate letters date)");
		expect(board).toContain("| A \\| B | N |");
		expect(renderBoard([], TODAY)).toContain("_Nothing due._\n\n## Letters due in 14 days\n\n_No letters due._");
	});
});

describe("ics export", () => {
	it("folds long lines at 75 octets with CRLF continuation", () => {
		const folded = foldLine("SUMMARY:" + "é".repeat(60));
		const parts = folded.split("\r\n");
		expect(parts.length).toBeGreaterThan(1);
		for (const p of parts) expect(new TextEncoder().encode(p).length).toBeLessThanOrEqual(75);
		expect(parts.slice(1).every((p) => p.startsWith(" "))).toBe(true);
	});
	it("writes an event per upcoming application deadline and per outstanding letters deadline, open notes only", async () => {
		const records = await loadFellowships(vault(), "Fellowships");
		const folded = renderIcs(records, TODAY, new Date("2026-11-07T15:00:00Z"));
		expect(folded).toContain("DESCRIPTION:Status: considering. Note: Fellowships/Alpha Foundation - Resea\r\n rch Fellowship.md");
		const ics = folded.replace(/\r\n /g, "");
		const events = ics.split("BEGIN:VEVENT").slice(1);
		expect(events).toHaveLength(4);
		expect(ics).toContain("UID:fellowship-fellowships-alpha-foundation-research-fellowship-letters@fellowship-companion\r\nDTSTAMP:20261107T150000Z\r\nDTSTART;VALUE=DATE:20261112\r\nDTEND;VALUE=DATE:20261113\r\nSUMMARY:Letters due: Alpha Foundation — Research Fellowship\r\nDESCRIPTION:1 of 3 letters received. Note: Fellowships/Alpha Foundation - Research Fellowship.md\r\nURL:https://alpha.example/rf");
		expect(ics).toContain("SUMMARY:Due: Alpha Foundation — Research Fellowship\r\nDESCRIPTION:Status: considering. Note: Fellowships/Alpha Foundation - Research Fellowship.md");
		expect(ics).toContain("SUMMARY:Due: Gamma Agency — Scholarship");
		expect(ics).toContain("SUMMARY:Letters due: Gamma Agency — Scholarship");
		expect(ics).not.toContain("Beta Trust");
		expect(ics).not.toContain("Delta Society");
		expect(ics.indexOf("DTSTART;VALUE=DATE:20261112")).toBeLessThan(ics.indexOf("DTSTART;VALUE=DATE:20261115"));
		expect(uidFor("Fellowships/A - B.md")).toBe("fellowship-fellowships-a-b@fellowship-companion");
		expect(ics.endsWith("END:VCALENDAR\r\n")).toBe(true);
	});
});
