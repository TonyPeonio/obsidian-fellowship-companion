import { App, Modal, Setting } from "obsidian";

export interface CallInput {
	text: string;
	url: string;
}

/** Asks for the pasted call text and, optionally, its URL. Resolves null when cancelled. */
export class CallModal extends Modal {
	private resolve!: (r: CallInput | null) => void;
	readonly result: Promise<CallInput | null>;
	private done = false;
	private input: CallInput = { text: "", url: "" };
	private errorEl: HTMLElement | null = null;

	constructor(
		app: App,
		private modelAvailable: boolean,
	) {
		super(app);
		this.result = new Promise((res) => (this.resolve = res));
	}

	onOpen(): void {
		const { contentEl, titleEl, modalEl } = this;
		modalEl.addClass("fc-modal");
		titleEl.setText("Add an opportunity");
		contentEl.createEl("p", {
			cls: "fc-modal-help",
			text: this.modelAvailable
				? "Paste the call for applications. Deadlines, amounts, eligibility statements and required materials are read deterministically; the local model fills in the name, funder and keywords and adds what the regexes missed. The call is kept verbatim in the note."
				: "Paste the call for applications. Ollama is not reachable, so only the deterministic pass runs: deadlines, amount, eligibility statements and required materials. Name, funder and keywords can be edited in the note.",
		});

		new Setting(contentEl)
			.setName("Call URL")
			.setDesc("Optional.")
			.addText((t) => {
				t.setPlaceholder("https://…").onChange((v) => (this.input.url = v.trim()));
				t.inputEl.addClass("fc-modal-wide");
			});

		const textarea = contentEl.createEl("textarea", { cls: "fc-modal-textarea", attr: { rows: "16", placeholder: "Paste the call text here…" } });
		textarea.addEventListener("input", () => (this.input.text = textarea.value));

		this.errorEl = contentEl.createEl("p", { cls: "fc-modal-error" });

		new Setting(contentEl)
			.addButton((b) => b.setButtonText("Cancel").onClick(() => this.finish(null)))
			.addButton((b) =>
				b
					.setButtonText("Add opportunity")
					.setCta()
					.onClick(() => {
						if (this.input.text.trim().length < 40) {
							this.errorEl?.setText("Paste the call text first (at least a few lines).");
							return;
						}
						if (this.input.url && !/^https?:\/\//i.test(this.input.url)) {
							this.errorEl?.setText("The URL should start with http:// or https://.");
							return;
						}
						this.finish(this.input);
					}),
			);
		textarea.focus();
	}

	private finish(r: CallInput | null): void {
		if (this.done) return;
		this.done = true;
		this.resolve(r);
		this.close();
	}

	onClose(): void {
		this.contentEl.empty();
		this.finish(null);
	}
}
