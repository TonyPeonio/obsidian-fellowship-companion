/** The application workflow and the note edits a status change makes. */

import { setFrontmatterValue } from "./frontmatter";
import { appendToSection } from "./sections";

export const STATUSES = ["considering", "preparing", "submitted", "interview", "awarded", "declined", "withdrawn"] as const;
export type Status = (typeof STATUSES)[number];

/** Statuses before submission: the board's due lists apply to these only. */
export const OPEN_STATUSES: readonly Status[] = ["considering", "preparing"];

/** Statuses still in play (listed first on the board). */
export const ACTIVE_STATUSES: readonly Status[] = ["considering", "preparing", "submitted", "interview"];

export function isStatus(s: string): s is Status {
	return (STATUSES as readonly string[]).includes(s);
}

/** The status after `current` in the workflow; wraps from withdrawn back to considering. */
export function nextStatus(current: Status): Status {
	const i = STATUSES.indexOf(current);
	return STATUSES[(i + 1) % STATUSES.length];
}

export function timelineLine(date: string, text: string): string {
	return `- ${date} — ${text}`;
}

/**
 * Sets `status` in the frontmatter and appends `- <today> — <status>` to the Timeline.
 * Moving to submitted fills `submitted_on` with today when it is empty. Returns the content
 * unchanged when the status is already `status`.
 */
export function applyStatus(content: string, currentStatus: Status, status: Status, today: string, currentSubmittedOn = ""): string {
	if (currentStatus === status) return content;
	let out = setFrontmatterValue(content, "status", status);
	if (status === "submitted" && !currentSubmittedOn) out = setFrontmatterValue(out, "submitted_on", today);
	return appendToSection(out, "Timeline", timelineLine(today, status));
}
