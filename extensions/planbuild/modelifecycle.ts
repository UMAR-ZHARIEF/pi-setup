// planbuild mode lifecycle: per-turn mode derivation from persisted mode stamps.
// Pure module: no Pi imports, no side effects. Callers pass entries in chronological
// order (index 0 oldest); mapping session-manager branch order to that shape is the
// caller's responsibility.

export type Mode = "plan" | "build";

export const MODE_ENTRY_TYPE = "planbuild-mode";

export interface LifecycleEntry {
	type: string;
	customType?: string;
	data?: { mode?: string } | Record<string, unknown>;
}

/**
 * Derive the mode for a turn from the entry list.
 * Walks backwards (newest first) and returns the mode of the first entry that is a
 * well-formed planbuild-mode stamp (type "custom", matching customType, and a data.mode
 * of "plan" or "build"). Malformed or unknown stamp values are skipped, not thrown.
 * Returns the fallback when no valid stamp exists.
 */
export function deriveTurnMode(entries: LifecycleEntry[], fallback: Mode): Mode {
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== MODE_ENTRY_TYPE) continue;
		const mode = entry.data?.mode;
		if (mode === "plan" || mode === "build") return mode;
	}
	return fallback;
}
