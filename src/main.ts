import { Notice, Plugin, TFile, normalizePath, requestUrl } from "obsidian";
import { BOARD_FILE, loadFellowships, renderBoard } from "./core/board";
import { emptyModelCall, extractionSystemPrompt, extractionUserMessage, mergeCall, parseJsonReply, validateModelCall, type ModelCall } from "./core/call";
import { today } from "./core/dates";
import { groundedCriteria, mergeScreening, parseProfile, parseScreening, renderScreening, screeningSystemPrompt, screeningUserMessage } from "./core/eligibility";
import { extractCall, splitSentences } from "./core/extract";
import { renderIcs } from "./core/ics";
import { guidanceSystemPrompt, guidanceUserMessage, letterFileName, lettersGuidance, parseGuidance, renderLetterRequest } from "./core/letters";
import { materialCategory, matchMaterials, renderMaterialsSection } from "./core/materials";
import { fellowshipFileName, namedLetters, parseFellowshipNote, renderFellowshipNote, setLetterDate, type FellowshipNote } from "./core/note";
import { OllamaClient, explainOllamaError } from "./core/ollama";
import { appendToSection, listItems, sectionBody, upsertSection } from "./core/sections";
import { applyStatus, timelineLine } from "./core/status";
import { filesInFolder, writeNote } from "./core/vault";
import { CallModal } from "./call-modal";
import { ObsidianVault } from "./obsidian-vault";
import { DEFAULT_SETTINGS, type FellowshipSettings } from "./settings";
import { FellowshipSettingTab } from "./settings-tab";
import { StatusModal } from "./status-modal";

export default class FellowshipCompanionPlugin extends Plugin {
	settings: FellowshipSettings = { ...DEFAULT_SETTINGS };
	client!: OllamaClient;
	vault!: ObsidianVault;

	async onload(): Promise<void> {
		await this.loadSettings();
		this.vault = new ObsidianVault(this.app);
		this.client = new OllamaClient(
			() => this.settings.ollamaUrl,
			(...args) => fetch(...args),
			async (url, body, method) => {
				const res = await requestUrl(method === "GET" ? { url, method, throw: false } : { url, method, contentType: "application/json", body, throw: false });
				return { status: res.status, text: res.text };
			},
		);
		this.addSettingTab(new FellowshipSettingTab(this.app, this));

		this.addRibbonIcon("award", "Add an opportunity", () => void this.addOpportunity());
		this.addCommand({ id: "add-opportunity", name: "Add an opportunity", callback: () => void this.addOpportunity() });
		this.addCommand({ id: "open-board", name: "Open the board", callback: () => void this.openBoard() });
		this.noteCommand("change-status", "Change status", (f) => this.changeStatus(f));
		this.noteCommand("check-materials", "Check materials", (f) => this.checkMaterials(f));
		this.noteCommand("draft-letter-requests", "Draft letter requests", (f) => this.draftLetterRequests(f));
		this.noteCommand("screen-eligibility", "Screen eligibility", (f) => this.screenEligibility(f));
	}

	/** A command that is available only while a fellowship note is open. */
	private noteCommand(id: string, name: string, run: (file: TFile) => Promise<void>): void {
		this.addCommand({
			id,
			name,
			checkCallback: (checking) => {
				const file = this.activeFellowshipFile();
				if (!file) return false;
				if (!checking) void run(file);
				return true;
			},
		});
	}

	// ---------------------------------------------------------------- commands

	async addOpportunity(): Promise<void> {
		const modelAvailable = await this.modelReachable();
		const modal = new CallModal(this.app, modelAvailable);
		modal.open();
		const input = await modal.result;
		if (!input) return;
		const date = today();
		const regex = extractCall(input.text, date);
		let model: ModelCall = emptyModelCall();
		let modelNote = "";
		if (modelAvailable) {
			const notice = new Notice(`Reading the call with ${this.settings.model}…`, 0);
			try {
				const reply = await this.chatJson(extractionSystemPrompt(), extractionUserMessage(input.text));
				const json = parseJsonReply(reply);
				if (!json) modelNote = " The model's reply was not JSON, so only the deterministic pass was used.";
				model = validateModelCall(json, date);
			} catch (err) {
				modelNote = ` ${explainOllamaError(err, this.settings.model, this.settings.ollamaUrl)} Only the deterministic pass was used.`;
			} finally {
				notice.hide();
			}
		} else {
			modelNote = " Ollama was not reachable, so only the deterministic pass was used.";
		}
		const fields = mergeCall(regex, model);
		const url = input.url || regex.url || "";
		const content = renderFellowshipNote({ ...fields, url, callText: input.text, today: date });
		const path = this.freePath(normalizePath(`${this.settings.fellowshipsFolder}/${fellowshipFileName(fields.funder, fields.name)}`));
		try {
			await writeNote(this.vault, path, content);
			await this.app.workspace.openLinkText(path, "", false);
		} catch (err) {
			new Notice(`Could not write the fellowship note ${path}: ${(err as Error).message}`, 10000);
			return;
		}
		const found = [
			fields.deadline ? `deadline ${fields.deadline}` : "no deadline found",
			fields.lettersDeadline ? `letters due ${fields.lettersDeadline}` : null,
			fields.amount ? fields.amount : null,
			`${fields.eligibility.length} eligibility line${fields.eligibility.length === 1 ? "" : "s"}`,
			`${fields.materials.length} material${fields.materials.length === 1 ? "" : "s"}`,
		]
			.filter(Boolean)
			.join(", ");
		new Notice(`Added ${fields.funder} — ${fields.name} (${found}).${modelNote}`, modelNote ? 10000 : 6000);
	}

	async changeStatus(file: TFile): Promise<void> {
		const note = await this.readFellowship(file);
		if (!note) return;
		const modal = new StatusModal(this.app, note.status);
		modal.open();
		const status = await modal.result;
		if (!status || status === note.status) return;
		const date = today();
		try {
			await this.app.vault.process(file, (content) => applyStatus(content, note.status, status, date, note.submittedOn));
			new Notice(`${note.funder} — ${note.name}: ${note.status} → ${status}.`);
		} catch (err) {
			new Notice(`Could not update ${file.path}: ${(err as Error).message}`, 10000);
		}
	}

	async openBoard(): Promise<void> {
		const date = today();
		const path = normalizePath(`${this.settings.fellowshipsFolder}/${BOARD_FILE}`);
		try {
			const records = await loadFellowships(this.vault, this.settings.fellowshipsFolder);
			await writeNote(this.vault, path, renderBoard(records, date));
			let extra = "";
			if (this.settings.exportIcs) {
				const icsPath = normalizePath(this.settings.icsPath);
				await writeNote(this.vault, icsPath, renderIcs(records, date, new Date()));
				extra = ` Deadlines exported to ${icsPath}.`;
			}
			await this.app.workspace.openLinkText(path, "", false);
			new Notice(`Board refreshed from ${records.length} fellowship note${records.length === 1 ? "" : "s"}.${extra}`);
		} catch (err) {
			new Notice(`Could not refresh the board: ${(err as Error).message}`, 10000);
		}
	}

	async checkMaterials(file: TFile): Promise<void> {
		const note = await this.readFellowship(file);
		if (!note) return;
		let content: string;
		try {
			content = await this.app.vault.read(file);
		} catch (err) {
			new Notice(`Could not read ${file.path}: ${(err as Error).message}`, 8000);
			return;
		}
		const required = note.materials.length ? note.materials : listItems(sectionBody(content, "Materials")).map((i) => i.replace(/\s+—.*$/, ""));
		const folder = normalizePath(this.settings.materialsFolder);
		const files = filesInFolder(this.vault, folder);
		const matches = matchMaterials(required, files);
		const named = namedLetters(note.letters);
		const total = Math.max(named.length, note.letters.length);
		const letters = { received: named.filter((r) => r.receivedOn !== "").length, total };
		const section = renderMaterialsSection(matches, folder, letters);
		const ready = matches.filter((m) => (m.category === "letters" ? total > 0 && letters.received >= total : m.files.length > 0)).length;
		const date = today();
		try {
			await this.app.vault.process(file, (c) => appendToSection(upsertSection(c, "Materials", section), "Timeline", timelineLine(date, `materials checked: ${ready} of ${matches.length} ready`)));
			const missing = matches.filter((m) => m.category !== "letters" && m.files.length === 0).map((m) => m.material);
			new Notice(required.length === 0 ? "No required materials listed in this note's properties." : `${ready} of ${matches.length} materials ready${missing.length ? `; missing: ${missing.join(", ")}` : ""}.${files.length === 0 ? ` Nothing found in ${folder}.` : ""}`, 8000);
		} catch (err) {
			new Notice(`Could not update ${file.path}: ${(err as Error).message}`, 10000);
		}
	}

	async draftLetterRequests(file: TFile): Promise<void> {
		const note = await this.readFellowship(file);
		if (!note) return;
		const pending = namedLetters(note.letters).filter((r) => r.askedOn === "");
		if (pending.length === 0) {
			new Notice(namedLetters(note.letters).length === 0 ? "No recommenders named yet. Add a name per row in the Letters table first." : "Every named recommender already has an \"asked on\" date.", 8000);
			return;
		}
		const sentences = splitSentences(note.callText);
		let guidance = lettersGuidance(sentences);
		let guidanceSource: "model" | "call" | "none" = guidance.length ? "call" : "none";
		if (note.callText.trim() && (await this.modelReachable())) {
			const notice = new Notice(`Asking ${this.settings.model} what the letters should address…`, 0);
			try {
				const points = parseGuidance(await this.chatJson(guidanceSystemPrompt(), guidanceUserMessage(note.callText)), note.callText);
				if (points && points.length > 0) {
					guidance = points;
					guidanceSource = "model";
				}
			} catch {
				// Deterministic sentences stand.
			} finally {
				notice.hide();
			}
		}
		const date = today();
		const materials = note.materials.filter((m) => materialCategory(m) !== "letters");
		const written: string[] = [];
		const skipped: string[] = [];
		for (const row of pending) {
			const path = normalizePath(`${this.settings.lettersFolder}/${letterFileName(row.recommender, note.name)}`);
			try {
				if (this.vault.exists(path)) skipped.push(row.recommender);
				else {
					await this.vault.create(path, renderLetterRequest({ recommender: row.recommender, name: note.name, funder: note.funder, amount: note.amount, deadline: note.deadline, lettersDeadline: note.lettersDeadline, url: note.url, notePath: file.path, guidance, guidanceSource, materials, today: date }));
					written.push(row.recommender);
				}
				await this.app.vault.process(file, (c) => setLetterDate(c, row.recommender, "askedOn", date));
			} catch (err) {
				new Notice(`Could not write ${path}: ${(err as Error).message}`, 10000);
				return;
			}
		}
		if (written.length) {
			try {
				await this.app.vault.process(file, (c) => appendToSection(c, "Timeline", timelineLine(date, `letter requests drafted for ${written.join(", ")}`)));
				await this.app.workspace.openLinkText(normalizePath(`${this.settings.lettersFolder}/${letterFileName(written[0], note.name)}`), "", false);
			} catch (err) {
				new Notice(`The requests were written, but ${file.path} could not be updated: ${(err as Error).message}`, 10000);
			}
		}
		new Notice(`${written.length} letter request${written.length === 1 ? "" : "s"} drafted under ${this.settings.lettersFolder}${skipped.length ? `; ${skipped.length} already existed (asked-on date set)` : ""}. Nothing was sent.`, 8000);
	}

	async screenEligibility(file: TFile): Promise<void> {
		const note = await this.readFellowship(file);
		if (!note) return;
		const profilePath = normalizePath(this.settings.profilePath);
		if (!this.vault.exists(profilePath)) {
			new Notice(`Profile note not found at ${profilePath}. Create it with lines like "citizenship: US", "degree: BS Physics", "year: junior", "gpa: 3.8", "field: physics", or set its path in settings.`, 10000);
			return;
		}
		let profile: ReturnType<typeof parseProfile>;
		let content: string;
		try {
			profile = parseProfile(await this.vault.read(profilePath));
			content = await this.app.vault.read(file);
		} catch (err) {
			new Notice(`Could not read the profile or the note: ${(err as Error).message}`, 8000);
			return;
		}
		const listed = note.eligibility.length ? note.eligibility : listItems(sectionBody(content, "Eligibility"));
		const { kept, dropped } = groundedCriteria(listed, note.callText);
		let model: Map<number, { verdict: "likely eligible" | "check" | "not eligible"; reason: string }> | null = null;
		let modelName: string | null = null;
		if (kept.length > 0 && (await this.modelReachable())) {
			const notice = new Notice(`Screening ${kept.length} criteria with ${this.settings.model}…`, 0);
			try {
				model = parseScreening(await this.chatJson(screeningSystemPrompt(), screeningUserMessage(kept, profile)), kept);
				if (model) modelName = this.settings.model;
			} catch (err) {
				new Notice(`${explainOllamaError(err, this.settings.model, this.settings.ollamaUrl)} Rules-only screen written.`, 8000);
			} finally {
				notice.hide();
			}
		}
		const results = mergeScreening(kept, profile, model);
		const date = today();
		const section = renderScreening(results, { today: date, profilePath, model: modelName, dropped });
		try {
			await this.app.vault.process(file, (c) => appendToSection(upsertSection(c, "Eligibility screen", section), "Timeline", timelineLine(date, "eligibility screened")));
			const n = (v: string) => results.filter((r) => r.verdict === v).length;
			new Notice(`Eligibility screen: ${n("likely eligible")} likely eligible, ${n("check")} to check, ${n("not eligible")} not eligible${dropped ? `; ${dropped} criteria skipped (not in the call text)` : ""}.`, 8000);
		} catch (err) {
			new Notice(`Could not update ${file.path}: ${(err as Error).message}`, 10000);
		}
	}

	// ---------------------------------------------------------------- helpers

	private chatJson(system: string, user: string): Promise<string> {
		return this.client.chat({
			model: this.settings.model,
			messages: [
				{ role: "system", content: system },
				{ role: "user", content: user },
			],
			options: { num_ctx: this.settings.numCtx, temperature: 0.1, top_p: 0.9, top_k: 20 },
			keep_alive: "10m",
			think: false,
			format: "json",
		});
	}

	private async readFellowship(file: TFile): Promise<FellowshipNote | null> {
		let content: string;
		try {
			content = await this.app.vault.read(file);
		} catch (err) {
			new Notice(`Could not read ${file.path}: ${(err as Error).message}`, 8000);
			return null;
		}
		const note = parseFellowshipNote(content);
		if (!note) new Notice("This note is not a fellowship note (it needs name, funder and status in its properties).");
		return note;
	}

	/** The open note when it is a fellowship note. */
	private activeFellowshipFile(): TFile | null {
		const file = this.app.workspace.getActiveFile();
		if (!file || file.extension !== "md") return null;
		const fm = this.app.metadataCache.getFileCache(file)?.frontmatter;
		return fm && typeof fm.name === "string" && typeof fm.funder === "string" && typeof fm.status === "string" ? file : null;
	}

	/** `path`, or `path (2)`, `path (3)`… when a note is already there. */
	private freePath(path: string): string {
		if (!this.vault.exists(path)) return path;
		const base = path.replace(/\.md$/, "");
		for (let i = 2; ; i++) {
			const candidate = `${base} (${i}).md`;
			if (!this.vault.exists(candidate)) return candidate;
		}
	}

	private async modelReachable(): Promise<boolean> {
		try {
			await Promise.race([this.client.version(), new Promise<never>((_, reject) => window.setTimeout(() => reject(new Error("timeout")), 2500))]);
			return true;
		} catch {
			return false;
		}
	}

	async loadSettings(): Promise<void> {
		const data = (await this.loadData()) as Partial<FellowshipSettings> | null;
		const s: FellowshipSettings = { ...DEFAULT_SETTINGS, ...(data ?? {}) };
		// data.json may have been edited by hand: keep the number and the paths usable.
		const n = Number(s.numCtx);
		s.numCtx = Number.isFinite(n) ? Math.min(262144, Math.max(2048, Math.round(n))) : DEFAULT_SETTINGS.numCtx;
		for (const key of ["ollamaUrl", "model", "fellowshipsFolder", "materialsFolder", "lettersFolder", "profilePath", "icsPath"] as const) {
			if (typeof s[key] !== "string" || !s[key].trim()) s[key] = DEFAULT_SETTINGS[key];
		}
		s.exportIcs = s.exportIcs === true;
		this.settings = s;
	}

	async saveSettings(): Promise<void> {
		await this.saveData(this.settings);
	}
}
