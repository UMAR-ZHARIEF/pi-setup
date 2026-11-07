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

/**
 * Derive the mode of the turn PRECEDING the last user message, or null when
 * there is no previous turn.
 *
 * Used by the one-shot build-switch speech (opencode reminders parity): the
 * speech rides the model calls of a build turn only when the immediately
 * preceding turn ran in plan mode. The previous turn's mode is derived from the
 * stamps preceding the PREVIOUS anchor (the user message before the last one),
 * so a build turn that follows a plan turn sees "plan" exactly once, and
 * consecutive build turns see "build" and inject nothing. Falls back to the
 * fallback mode when no valid stamp precedes the previous anchor; returns null
 * when there is no previous anchor at all (first turn of a session).
 */
export function derivePreviousTurnMode(entries: LifecycleEntry[], fallback: Mode): Mode | null {
	let anchor = -1;
	for (let i = entries.length - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message?.role === "user") {
			anchor = i;
			break;
		}
	}
	if (anchor === -1) return null;
	let previous = -1;
	for (let i = anchor - 1; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type === "message" && entry.message?.role === "user") {
			previous = i;
			break;
		}
	}
	if (previous === -1) return null;
	for (let i = previous; i >= 0; i--) {
		const entry = entries[i];
		if (entry.type !== "custom" || entry.customType !== MODE_ENTRY_TYPE) continue;
		const mode = entry.data?.mode;
		if (mode === "plan" || mode === "build") return mode;
	}
	return fallback;
}

// Post-approval override (plan part 3, plan_exit race fix): on approval, the
// session may dispatch a few milliseconds BEFORE the steered "plan approved" user
// message lands; the anchor is still the old plan-era stamp, so plain derivation
// would deny with "switch to build mode" right after the user approved switching.
// The override is the sanctioned exception: once plan_exit is approved, the gate
// returns build for the REMAINDER OF THAT TURN regardless of the anchor, and the
// state clears at the next turn start (index.ts clears it in before_agent_start).
// The steered user message remains the derivation anchor for subsequent turns.
export interface PostApprovalOverride {
	activate(): void;
	clear(): void;
	isActive(): boolean;
}

export function createPostApprovalOverride(): PostApprovalOverride {
	let active = false;
	return {
		activate(): void {
			active = true;
		},
		clear(): void {
			active = false;
		},
		isActive(): boolean {
			return active;
		},
	};
}

// Gate-mode resolution with the override applied: build while the override is
// active, otherwise the anchor-derived mode unchanged.
export function resolveGateMode(override: PostApprovalOverride, derived: Mode): Mode {
	return override.isActive() ? "build" : derived;
}
