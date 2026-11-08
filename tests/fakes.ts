import type { FileInfo, NoteInfo, VaultAccess } from "../src/core/vault";

/** In-memory vault for tests. Any path is a file; `.md` paths are also notes. */
export class FakeVault implements VaultAccess {
	private files = new Map<string, string>();
	private mtimes = new Map<string, number>();

	constructor(initial: Record<string, string> = {}, mtimeIso = "2026-11-01") {
		for (const [p, c] of Object.entries(initial)) {
			this.files.set(p, c);
			this.mtimes.set(p, Date.parse(`${mtimeIso}T12:00:00Z`));
		}
	}

	listNotes(): NoteInfo[] {
		return Array.from(this.files.keys())
			.filter((p) => p.endsWith(".md"))
			.map((path) => ({
				path,
				basename: (path.split("/").pop() ?? path).replace(/\.md$/, ""),
				folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
				mtime: this.mtimes.get(path) ?? 0,
			}));
	}

	listFiles(): FileInfo[] {
		return Array.from(this.files.keys()).map((path) => {
			const name = path.split("/").pop() ?? path;
			const dot = name.lastIndexOf(".");
			return {
				path,
				basename: dot > 0 ? name.slice(0, dot) : name,
				extension: dot > 0 ? name.slice(dot + 1).toLowerCase() : "",
				folder: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "",
			};
		});
	}

	listFolders(): string[] {
		const out = new Set<string>();
		for (const path of this.files.keys()) {
			const parts = path.split("/");
			for (let i = 1; i < parts.length; i++) out.add(parts.slice(0, i).join("/"));
		}
		return Array.from(out).sort();
	}

	exists(path: string): boolean {
		return this.files.has(path);
	}

	async read(path: string): Promise<string> {
		const c = this.files.get(path);
		if (c === undefined) throw new Error(`Note not found: ${path}`);
		return c;
	}

	async create(path: string, content: string): Promise<void> {
		if (this.files.has(path)) throw new Error(`Already exists: ${path}`);
		this.files.set(path, content);
		this.mtimes.set(path, Date.now());
	}

	async modify(path: string, content: string): Promise<void> {
		if (!this.files.has(path)) throw new Error(`Note not found: ${path}`);
		this.files.set(path, content);
	}
}

/** A US graduate fellowship with two deadlines, letters, GPA and citizenship rules. */
export const US_FELLOWSHIP = `Meridian Graduate Research Fellowship 2027
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
Questions: fellowships@meridian-sf.example. Apply at https://meridian-sf.example/grf
`;

/** A European travel grant: euro per month style amount, one deadline, no letters. */
export const TRAVEL_GRANT = `Call for applications: Nordlicht Student Travel Grant
Funder: Nordlicht Foundation for Early-Career Researchers

The Nordlicht Student Travel Grant covers travel and subsistence for undergraduate and master's students presenting a first-author poster or talk at an international conference in Europe. The grant provides up to €1,500/month for stays of one to three months, or a single payment of €800 for conference attendance of under a week.

Who can apply
Students enrolled at a European university in any field of the natural sciences, of any nationality. Applicants must be under 30 years of age at the time of application and in good academic standing.

How to apply
Submit a CV, a one-page motivation letter, a budget (travel, accommodation, registration) and the conference acceptance notice through the portal. No letters of recommendation are required.

Applications close on 1 December 2026. Decisions are sent within six weeks.
`;
