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
	// Minimal, dependency-free view of a session message entry (pi SessionMessageEntry
	// carries the full AgentMessage; only the role is needed to find the turn anchor).
	message?: { role?: string };
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

/**
 * Derive the mode for the turn anchored at the LAST user message in the list.
 *
 * A queued turn (message typed or steered while another turn streams) never passes
 * pi's turn-start hook, but its user message IS appended to the live branch before its
 * turn runs, and any mode flip pressed before that delivery stamps earlier on the
 * branch. Anchoring at the last user message and consulting only stamps that PRECEDE
 * it is therefore correct for direct and queued turns alike: a flip stamped after the
 * anchor (a mid-turn flip) still cannot affect the running turn.
 *
 * Walks backwards to the last entry with type "message" and message.role "user"; if
 * none exists, returns the fallback. Then walks backwards from that anchor and returns
 * the mode of the nearest preceding well-formed planbuild-mode stamp (same validity
 * rules as deriveTurnMode). Returns the fallback when no valid stamp precedes the
 * anchor.
 */
export function deriveModeForTurn(entries: LifecycleEntry[], fallback: Mode): Mode {
	let anchor = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message?.role === "user") {
			anchor = i;
			break;
		}
	}
	if (anchor === -1) return fallback;
	for (let i = anchor; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== MODE_ENTRY_TYPE) continue;
		const mode = entry.data?.mode;
		if (mode === "plan" || mode === "build") return mode;
	}
	return fallback;
}
