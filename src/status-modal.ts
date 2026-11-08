import { App, SuggestModal } from "obsidian";
import { STATUSES, nextStatus, type Status } from "./core/status";

/** Picks a status; the workflow's next step is listed first and marked. */
export class StatusModal extends SuggestModal<Status> {
	private resolve!: (s: Status | null) => void;
	readonly result: Promise<Status | null>;
	private done = false;

	constructor(
		app: App,
		private current: Status,
	) {
		super(app);
		this.setPlaceholder(`Current status: ${current}. Pick the new one.`);
		this.result = new Promise((res) => (this.resolve = res));
	}

	getSuggestions(query: string): Status[] {
		const next = nextStatus(this.current);
		const ordered: Status[] = [next, ...STATUSES.filter((s) => s !== next)];
		const q = query.toLowerCase();
		return ordered.filter((s) => s.includes(q));
	}

	renderSuggestion(status: Status, el: HTMLElement): void {
		el.createSpan({ text: status });
		if (status === nextStatus(this.current)) el.createSpan({ cls: "fc-status-hint", text: "next" });
		if (status === this.current) el.createSpan({ cls: "fc-status-hint", text: "current" });
	}

	onChooseSuggestion(status: Status): void {
		this.done = true;
		this.resolve(status);
	}

	onClose(): void {
		super.onClose();
		// Obsidian closes the modal before calling onChooseSuggestion, so the null result for a
		// dismissed modal is deferred one tick; a choice made in between wins.
		window.setTimeout(() => {
			if (!this.done) {
				this.done = true;
				this.resolve(null);
			}
		}, 0);
	}
}
