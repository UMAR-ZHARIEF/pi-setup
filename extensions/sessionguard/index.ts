// sessionguard: closes the session-file flush race at session entry.
// pi buffers session-file writes and flushes late, including at process death
// (session-manager.js _persist, the flushed flag), and SessionManager._buildIndex
// sets the resume leaf to the LAST PHYSICAL ENTRY in the file
// (dist/core/session-manager.js:687-703). Restarting pi while the previous process
// is still alive can therefore resume a stale leaf; the old process's tail flushes
// seconds later and becomes an invisible dead branch. Fix: on session_start, once,
// re-read the SAME session file through the session manager's own setSessionFile,
// which reruns _setSessionFile -> _loadEntries -> _buildIndex
// (dist/core/session-manager.js:617-638, 672-685). ctx.sessionManager is typed
// ReadonlySessionManager (types.d.ts:220; Pick without setSessionFile, d.ts:152),
// so the mutating call goes through a cast: compile-time only, the runtime object
// is the full SessionManager, the same reachability the mutating-gate worker proved
// for appendCustomMessageEntry (session-manager.js:901).
//
// Behavior bounds: never runs mid-turn (session_start only), stays silent when
// nothing changed, never notifies on failure, never breaks session startup. See
// ./guard.ts for every decision rule and the README for the incident record.

import { existsSync } from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	decideRecovery,
	formatCheckReport,
	runGuardStep,
	shouldAttemptReload,
	snapshotSession,
	type SessionguardCheck,
	type SessionSnapshot,
	type SkipReason,
} from "./guard.ts";

// The slice of SessionManager this extension touches beyond the readonly surface.
interface ReloadableSessionManager {
	getSessionFile(): string | undefined;
	getEntries(): Array<{ timestamp?: string }>;
	getLeafId(): string | null;
	flushed: boolean;
	setSessionFile(sessionFile: string): void;
}

let lastCheck: SessionguardCheck | null = null;

function recordCheck(check: SessionguardCheck): void {
	lastCheck = check;
}

function recordSkip(file: string | null, reason: string, outcome: SkipReason): void {
	lastCheck = { file, reason, outcome, before: null, after: null, gainedEntries: 0, checkedAt: new Date().toISOString() };
}

// The one reload attempt. Called only from session_start, never mid-turn. Throws
// are caught by the runGuardStep wrapper at the call site: on any error nothing
// is notified and startup continues untouched.
function runEntryCheck(reason: string, ctx: ExtensionContext): void {
	const sm = ctx.sessionManager as unknown as ReloadableSessionManager;
	const sessionFile = sm.getSessionFile();
	const entries = sm.getEntries();
	const skip = shouldAttemptReload({
		sessionFile,
		entryCount: entries.length,
		fileExists: sessionFile ? existsSync(sessionFile) : false,
		flushed: sm.flushed === true,
	});
	if (skip) {
		recordSkip(sessionFile ?? null, reason, skip);
		return;
	}
	const path = sessionFile as string;
	const before: SessionSnapshot = snapshotSession(entries, sm.getLeafId());
	sm.setSessionFile(path); // same path: pure re-read plus index rebuild
	const after: SessionSnapshot = snapshotSession(sm.getEntries(), sm.getLeafId());
	const decision = decideRecovery(before, after);
	recordCheck({
		file: path,
		reason,
		outcome: decision.notify ? "recovered" : "silent",
		before,
		after,
		gainedEntries: decision.gainedEntries,
		checkedAt: new Date().toISOString(),
	});
	if (decision.gainedEntries < 0) {
		// Unreachable behind the gain-only guard; say it in the log, never to the user.
		console.error(`sessionguard: reload lost ${-decision.gainedEntries} entries on ${path}; not notifying.`);
	}
	if (decision.notify && decision.message) {
		ctx.ui.notify(decision.message, "info");
	}
}

export default function sessionguardExtension(pi: ExtensionAPI): void {
	pi.on("session_start", (event, ctx) => {
		const result = runGuardStep(() => runEntryCheck(String(event?.reason ?? "startup"), ctx));
		if (!result.ok) {
			console.error("sessionguard: session_start check failed silently:", result.error);
		}
	});

	pi.registerCommand("sessionguard", {
		description: "Report the last sessionguard flush-race check (leaf, entries gained, timestamp)",
		handler: (_args, ctx) => {
			ctx.ui.notify(formatCheckReport(lastCheck), "info");
		},
	});
}
