// sessionguard recovery decision: pure module, no Pi imports.
// The defect this supports: pi buffers session-file writes and flushes late
// (session-manager.js _persist, the flushed flag), and SessionManager._buildIndex
// sets the resume leaf to the LAST PHYSICAL ENTRY in the file. Restarting pi while
// the previous process is still alive can resume a stale leaf; the old process's
// tail then flushes seconds later and becomes an invisible dead branch. The
// extension re-reads the same session file once at session_start via the session
// manager's own setSessionFile; this module holds every decision that call needs,
// so the reasoning is unit-testable without a running Pi.

// Minimal structural view of a session entry (pi SessionEntry carries much more;
// only the ISO timestamp string is needed for the report).
export interface SnapshotEntry {
	timestamp?: string;
}

// The three numbers captured before and after the reload.
export interface SessionSnapshot {
	leafId: string | null;
	entryCount: number;
	lastTimestamp: string | null;
}

export function snapshotSession(entries: readonly SnapshotEntry[], leafId: string | null): SessionSnapshot {
	const last = entries.length > 0 ? entries[entries.length - 1] : undefined;
	return {
		leafId,
		entryCount: entries.length,
		lastTimestamp: last?.timestamp ?? null,
	};
}

// Why a session_start check skipped the reload. null means "go".
// no-session-file: ephemeral session, nothing on disk to re-read.
// header-only: brand-new session, only the header entry exists in memory; there
// is no prior content the initial load could have missed.
// file-missing: the session file does not exist on disk yet (a new session that
// has never flushed); setSessionFile would treat this as a switch, not a reload.
// unflushed: the session manager holds entries that are not on disk yet
// (flushed !== true). Reloading now would REPLACE memory with the file and drop
// those entries, the exact data-loss class this extension exists to prevent.
// The reload only runs when flushed is true, which guarantees every in-memory
// entry is already appended to the file, so the reload can only gain.
export type SkipReason = "no-session-file" | "header-only" | "file-missing" | "unflushed";

export interface ReloadPreconditions {
	sessionFile: string | null | undefined;
	entryCount: number;
	fileExists: boolean;
	flushed: boolean;
}

export function shouldAttemptReload(pre: ReloadPreconditions): SkipReason | null {
	if (!pre.sessionFile) return "no-session-file";
	if (pre.entryCount <= 1) return "header-only";
	if (!pre.fileExists) return "file-missing";
	if (!pre.flushed) return "unflushed";
	return null;
}

// One-line recovery notice. N is the number of entries the reload gained.
export function formatRecoveryNotice(gained: number): string {
	return `sessionguard: recovered ${gained} newer entries the initial load missed; resumed from the complete state.`;
}

export interface RecoveryDecision {
	notify: boolean;
	gainedEntries: number;
	message: string | null;
}

// Compare the pre-reload and post-reload state of the SAME session manager.
// Notify when the reload gained entries (the restart race: the dying process's
// tail flushed after this process loaded) or when the leaf moved onto a different
// chain with the same count (leaf correction with no growth; cannot happen with
// an append-only file, but if it is ever observed the user must hear about it).
// A negative gain means the reload LOST entries, which the gain-only guard makes
// unreachable; stay silent and let the caller log it. Unchanged means silent:
// the normal case must never produce noise.
export function decideRecovery(before: SessionSnapshot, after: SessionSnapshot): RecoveryDecision {
	const gained = after.entryCount - before.entryCount;
	if (gained < 0) return { notify: false, gainedEntries: gained, message: null };
	const leafMoved = before.leafId !== null && after.leafId !== null && before.leafId !== after.leafId;
	if (gained === 0 && !leafMoved) return { notify: false, gainedEntries: 0, message: null };
	return { notify: true, gainedEntries: gained, message: formatRecoveryNotice(gained) };
}

// Never-throw wrapper for the session_start check: any error becomes a result
// value so a failure can neither break session startup nor produce a notify.
// The caller logs ok:false via console.error only.
export type GuardStepResult<T> = { ok: true; value: T } | { ok: false; error: unknown };

export function runGuardStep<T>(step: () => T): GuardStepResult<T> {
	try {
		return { ok: true, value: step() };
	} catch (error) {
		return { ok: false, error };
	}
}

// Record of the last check, reported by the /sessionguard command.
export interface SessionguardCheck {
	file: string | null;
	reason: string;
	outcome: SkipReason | "recovered" | "silent";
	before: SessionSnapshot | null;
	after: SessionSnapshot | null;
	gainedEntries: number;
	checkedAt: string;
}

export function formatCheckReport(check: SessionguardCheck | null): string {
	if (!check) {
		return "sessionguard: no check recorded yet (ephemeral, brand-new, or header-only session at startup).";
	}
	const lines = [`sessionguard last check: ${check.checkedAt} (session_start reason: ${check.reason})`];
	if (check.outcome !== "recovered" && check.outcome !== "silent") {
		lines.push(`reload skipped: ${check.outcome}`);
	}
	if (check.before) {
		lines.push(
			`leaf before: ${check.before.leafId ?? "(none)"} | entries before: ${check.before.entryCount} | last entry: ${check.before.lastTimestamp ?? "(none)"}`,
		);
	}
	if (check.after) {
		lines.push(
			`leaf after: ${check.after.leafId ?? "(none)"} | entries after: ${check.after.entryCount} | last entry: ${check.after.lastTimestamp ?? "(none)"}`,
		);
	}
	lines.push(`entries gained: ${check.gainedEntries}`);
	return lines.join("\n");
}
