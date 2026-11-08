# Fellowship Companion

An [Obsidian](https://obsidian.md) plugin for students and researchers who apply for grants,
fellowships and scholarships: paste a call for applications and get a **structured note**
(deadline, letters deadline, amount, eligibility, required materials, the call kept verbatim),
move it through a **status workflow** with a dated timeline, see every opportunity on a **board**
with what is due and whose letters are outstanding, **check your materials folder** against what
the call asks for, **draft letter requests** for your recommenders, and run an **eligibility
screen** of the call's criteria against your profile with a **local model**
(via [Ollama](https://ollama.com)). Everything runs on your machine; nothing is sent to a funder,
a recommender, a vendor or anyone else.

- **A note per opportunity, in your vault.** `Fellowships/<Funder> - <Name>.md` with properties
  you can query with Dataview or Bases, the call as pasted, eligibility and materials as
  plain lists (no checkboxes, so nothing leaks into your task queries), a Letters table (recommender, asked on, received on), your notes, and a timeline of
  every change.
- **Deterministic first, model second.** Deadlines (six common date formats, with the
  letters-of-recommendation deadline told apart from the application deadline), amounts with a
  currency (`$38,000 per year`, `€1,500/month`, `up to £2,000`), eligibility statements and
  required materials are read with regular expressions and win over anything the model says. The
  model fills what the regexes cannot: the name, the funder, keywords, and eligibility or
  materials lines the regexes missed. Its dates are re-read by the deterministic parser, never
  trusted as written. Without Ollama the regex pass, the board, the materials check and the letter
  drafts all work.
- **Grounded letters and screening.** Letter drafts quote what the call says letters should
  address; when the model summarises it, every point is checked against the call's own words and
  dropped otherwise. The eligibility screen quotes only criteria that appear in the call, decides
  GPA, citizenship, degree level, year, age and field by rules, and lets the model assess only the
  rest. Nothing is ever sent: the letter request is a note for you to copy.
- Free and open source, MIT licensed. No accounts, no API keys, no telemetry.

## Requirements

1. Obsidian 1.7.2 or later (desktop or mobile).
2. Optional: [Ollama](https://ollama.com) running locally (or on another machine on your network;
   set its URL in settings) with a chat model: `ollama pull qwen3.5:9b` (default; fits a 12 GB
   GPU), `qwen3.5:4b` for smaller cards. Without Ollama, *Add an opportunity* runs only the
   deterministic pass (deadlines, amount, eligibility, materials, first line as the name), and the
   board, status workflow, materials check, letter requests (with sentences copied from the call)
   and calendar export work as usual; *Screen eligibility* writes a rules-only screen.

## Usage

1. **Add an opportunity** (ribbon icon or command). Paste the call text and, optionally, its URL.
   The note opens as `Fellowships/<Funder> - <Name>.md` with status `considering`. Check the
   properties: `deadline` and `letters_deadline` are what the regexes found, so a call that says
   "rolling" will have an empty deadline for you to fill.
2. Put your materials in `Fellowships/Materials` (notes or files named after what they are:
   `CV.md`, `Transcript Fall 2026.pdf`, `Personal statement - NSF.md`, `Research statement.md`,
   `Budget.xlsx`). With the note open, **Check materials** rewrites `## Materials` as a list:
   found items link to the file, missing items say what name would match.
3. Fill a recommender per row of the Letters table. **Draft letter requests** writes
   `Fellowships/Letters/<Recommender> - <Name>.md` for every named row without an "asked on" date
   (a summary, the letters deadline, what the call asks letters to address, the materials you will
   attach, and a short message to copy) and fills "asked on" with today. Type the date into
   "received on" yourself when the letter lands.
4. Write `Profile.md` (lines like `citizenship: United States`, `degree: BS Physics
   (undergraduate)`, `year: junior`, `gpa: 3.8`, `field: physics`, `age: 21`, as properties or
   `key: value` lines). **Screen eligibility** writes one line per criterion under
   `## Eligibility screen`: *likely eligible*, *check* or *not eligible*, the criterion quoted, and
   the reason.
5. When you submit, run **Change status** and pick *submitted*: `submitted_on` is set to today and
   the timeline gets a dated line. Keep going through interview, awarded, declined or withdrawn.
6. **Open the board** writes `Fellowships/Board.md`: what is due in the next 30 days, whose letters
   are due in the next 14 days, then a table per status with days left, letters received and
   materials ready. Re-running it rewrites only that note.

### Commands

| Command | What it does |
|---|---|
| Add an opportunity | Paste a call; regex pass + one local-model call; writes the fellowship note |
| Change status | considering → preparing → submitted → interview → awarded → declined → withdrawn; sets `submitted_on` and a timeline line |
| Check materials | Matches the required materials against the Materials folder; rewrites `## Materials` as a list: found items link to the file, missing items name what would match |
| Draft letter requests | One request note per named recommender without an "asked on" date; marks "asked on"; never sends anything |
| Open the board | Rewrites `Fellowships/Board.md` (due in 30 days, letters due in 14 days, a table per status); optional `.ics` export of both deadline kinds |
| Screen eligibility | Rules + optional model verdict per quoted criterion against `Profile.md`, under `## Eligibility screen` |

*Add an opportunity* and *Open the board* work anywhere; the other four commands need a fellowship note open (one with `name`, `funder` and
`status` in its properties).

### Note shape

````markdown
---
name: Meridian Graduate Research Fellowship 2027
funder: Meridian Science Foundation
amount: $38,000 per year
deadline: 2026-10-15
letters_deadline: 2026-10-22
status: considering
submitted_on: ""
eligibility:
  - "Applicants must be U.S. citizens, U.S. nationals or permanent residents."
  - A minimum cumulative GPA of 3.5 on a 4.0 scale is required.
materials:
  - Personal statement
  - Research statement
  - Transcript
  - CV
  - 3 letters of recommendation
url: "https://…"
keywords:
  - physics
  - materials science
source: fellowship
---

# Meridian Science Foundation — Meridian Graduate Research Fellowship 2027

**Amount:** $38,000 per year
**Deadline:** 2026-10-15
**Letters deadline:** 2026-10-22

## Call
```text
(the pasted text, verbatim, in a fence so its headings, #tags and links stay inert)
```

## Eligibility
- Applicants must be U.S. citizens, U.S. nationals or permanent residents.
…

## Materials
- CV — [[Fellowships/Materials/CV]]
- Transcript — missing: nothing in `Fellowships/Materials` matches "transcript"
- 3 letters of recommendation — 1 of 3 received

## Letters
| Recommender | Asked on | Received on |
|---|---|---|
| Prof. Carr | 2026-11-07 | |
|  |  |  |
|  |  |  |

## Timeline
- 2026-11-07 — added
- 2026-11-07 — materials checked: 1 of 5 ready
- 2026-11-07 — letter requests drafted for Prof. Carr

## Notes
````

`## Materials` is rewritten by *Check materials*, `## Eligibility screen` by *Screen
eligibility*, and the Letters table's "asked on" cells by *Draft letter requests*. Everything else
in the note is yours; the plugin edits only the frontmatter key it changes and the section it
owns.

### How it works

**Deterministic pass.** The call is split into sentences. Dates are read in `2026-10-15`,
`10/15/2026` (day first when the first number cannot be a month), `Oct 15`, `October 15, 2026`,
`15 October 2026` and `15th Oct` forms; month-day without a year takes the next occurrence on or
after today. A sentence with deadline wording ("deadline", "due", "apply by", "closes", "must be
received by", …) that mentions letters, references or recommenders sets `letters_deadline`; one
without letter wording sets `deadline`; strong wording beats a bare "by <date>"; sentences about
notification, start or award dates are skipped; vague wording ("rolling") yields nothing. Amounts
need a currency symbol or code and a value of at least 100 (`$38,000 per year`, `€1,500/month`,
`up to 5,000 USD`, `£2k`); sentences about fees are skipped. Eligibility statements come from the
block under an *Eligibility* / *Who can apply* heading plus any sentence with eligibility wording
("must be", "eligible", "citizens", "enrolled", "GPA", …) about an eligibility topic. Materials
are the kinds mentioned anywhere (CV/resume, transcript, personal statement/statement of
purpose/motivation letter, research statement/proposal, budget, N letters of recommendation),
labelled and ordered by first mention, skipping negated mentions ("no letters are required"),
plus unknown bullets of a materials block kept verbatim. The funder comes from a `Funder:` label
or "offered/funded/administered by the …"; the name from a `Program:` label or the first line.

**Model pass.** One chat call (temperature 0.1, thinking off, JSON mode) with a fixed schema:
name, funder, amount, deadline and letters_deadline (copied as written), eligibility (≤ 12),
materials (≤ 12), letters_count, keywords (≤ 12). The reply is parsed as JSON, every field is
type-checked, lists are capped and de-duplicated, both deadlines go through the same date parser,
and the regex results win wherever both have a value. Model eligibility and materials lines are
appended only when they say something new (a second "CV" under another name is dropped).

**Materials check.** Every file under the Materials folder (recursively, any extension) is
classified by its name with the same keyword rules as the required materials; a required item is
ticked when a file of its kind exists, or, for an unknown kind such as "Writing sample", when every
significant word of the item appears in a file name. Letters are ticked when every expected letter
has a "received on" date. Deterministic, no model.

**Letter requests.** What letters should address is taken from the sentences of the call that
mention letters or recommenders together with guidance wording ("should address", "speak to",
"evaluate", …). With Ollama reachable the model is asked for up to five points, and each point is
kept only when at least 60% of its content words occur in the call text; otherwise the copied
sentences stand. A request note is written only when none exists for that recommender and
opportunity, so re-running is safe.

**Eligibility screen.** Criteria come from the note's `eligibility` property (or the `##
Eligibility` list) and are kept only when they appear in the call text, so the screen never
quotes a requirement the call does not make. Rules decide GPA thresholds (ignoring the "4.0
scale"), U.S. citizenship and permanent residency (and "any nationality" calls), undergraduate
versus graduate level, year of study, age limits and field lists; a criterion about a degree
already held is always "check". With Ollama reachable the model (temperature 0.1, JSON mode)
assesses the remaining criteria by index, never by quoting them; rule verdicts override the model.

**Board.** Reads every fellowship note under the Fellowships folder. Letters expected = named
rows, or the count in the materials list; letters received = rows with a "received on" date.
Materials ready = ticked items under `## Materials`. Due = considering or preparing, deadline
within 30 days; letters due = considering or preparing, letters outstanding, letters deadline (or
the application deadline when the call states none) within 14 days. The `.ics` export (optional)
writes an all-day event per upcoming application deadline and per outstanding letters deadline
with UIDs derived from the note path, so re-exports update rather than duplicate.

## Settings worth knowing

- **Fellowships folder** (default `Fellowships`), **Materials folder** (`Fellowships/Materials`),
  **Letters folder** (`Fellowships/Letters`), **Profile note** (`Profile.md`).
- **Export deadlines as a calendar file** and its path (default `Fellowships/deadlines.ics`).
- **Ollama URL**, **Chat model**, **Context window**.

## Privacy and network use

The plugin makes network requests only to the Ollama URL you set (localhost by default), and only
when you run *Add an opportunity*, *Draft letter requests* or *Screen eligibility* with Ollama
reachable. It does not fetch the call URL you paste, does not contact funders or recommenders,
and sends nothing anywhere else: letter requests are notes in your vault for you to send yourself.
It reads the notes in the Fellowships folder, the Materials folder and your profile note, and
writes under the Fellowships folder. No telemetry, no accounts.

## Development

```bash
npm install
npm run dev        # watch build → main.js
npm test           # unit tests (vitest), no Ollama needed
npm run build      # type-check + Obsidian review lint + production bundle
npm run call:live  # extraction, letters-guidance and screening prompts against a running Ollama on two sample calls (4 calls)
```

To release: bump `version` in `manifest.json` and `package.json`, add the version to
`versions.json`, write `release-notes/<version>.md`, commit, then push a tag named exactly
`<version>`. The release workflow builds, tests, attests and publishes the GitHub release.

`src/core/` (extraction, call schema and merge, note rendering and parsing with the Letters
table, sections, status, materials matching, letter requests, eligibility rules and screening,
board, ICS, Ollama client) has no Obsidian dependency and is tested against an in-memory vault;
`src/main.ts`, the modals and the settings tab are the thin Obsidian layer.

This plugin started from [Job Hunt Companion](https://github.com/TonyPeonio/obsidian-job-hunt-companion)
(same author, MIT). Copied as is or with renames: the build, lint, test, CI and release
configuration, `version-bump.mjs`, the Ollama client (`src/core/ollama.ts`), the date parser
(`dates.ts`), the frontmatter and section editors (`frontmatter.ts`, `sections.ts`), the ICS
writer (adapted for two event kinds), the status module (new workflow), the vault abstraction
(extended with file listing), the call and status modals (including the deferred-null fix in the
status modal), the settings tab, the JSON-reply parser and validation helpers, the in-memory test
vault and the Obsidian mock. Extraction, the call schema and merge, the note with its Letters
table, materials matching, letter requests, the eligibility screen and the board are new.

Fellowship Companion is part of the Companion suite of local-first Obsidian plugins by Tony Peonio
for students and researchers: your machine does the work, every change is a diff you approve, and
the numbers are published. The others are Local Vault Agent (local Ollama agent that searches,
compiles, edits notes), Lecture Companion (live local lecture transcription, Canvas slides, Ollama
summaries), Canvas Companion (Canvas LMS assignments, grades and announcements as notes), Exam
Companion (day-by-day study plan, daily quizzes and flashcards), Paper Companion (Zotero search by
meaning, page-cited reading notes), Research Log Companion (append-only lab notebook with git,
parameters, data hashes), Job Hunt Companion (job applications as notes, resume tailoring, interview
questions), Code Companion (commits in the daily note, weekly report, TODOs), Teaching Companion
(local-model rubric grading with verbatim evidence) and Branching Table of Contents (parent/child
properties as a rooted family tree). All at [github.com/TonyPeonio](https://github.com/TonyPeonio).

## License

MIT
