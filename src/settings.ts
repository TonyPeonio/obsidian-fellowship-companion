export interface FellowshipSettings {
	ollamaUrl: string;
	model: string;
	numCtx: number;
	/** Folder for fellowship notes and the board. */
	fellowshipsFolder: string;
	/** Folder scanned by Check materials. */
	materialsFolder: string;
	/** Folder where letter-request drafts are written. */
	lettersFolder: string;
	/** Vault path of the profile note Screen eligibility reads. */
	profilePath: string;
	/** Also write an .ics of upcoming deadlines when the board is refreshed. */
	exportIcs: boolean;
	icsPath: string;
}

export const DEFAULT_SETTINGS: FellowshipSettings = {
	ollamaUrl: "http://localhost:11434",
	model: "qwen3.5:9b",
	numCtx: 16384,
	fellowshipsFolder: "Fellowships",
	materialsFolder: "Fellowships/Materials",
	lettersFolder: "Fellowships/Letters",
	profilePath: "Profile.md",
	exportIcs: false,
	icsPath: "Fellowships/deadlines.ics",
};
