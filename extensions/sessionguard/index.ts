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
//
// First-turn context rebuild: the runtime snapshot problem. agent.state.messages
// is snapshotted ONCE at load (sdk.js:260-262) and rebuilt only at compaction
// and branch navigation (agent-session.js:1657-1660, 2724-2727), so right after
// the entry check recovers, the model still sees the stale startup list. Fix:
// a pi.on("context") handler, which the runtime fires before EVERY LLM call,
// first turn included (runner.js emitContext, wired via transformContext at
// sdk.js:248-253). While armed (an entry check gained entries), the handler
// returns the corrected session manager's buildSessionContext().messages,
// REPLACING the list the model receives for that call; while disarmed it
// returns nothing, so the model context is untouched. The handler stays armed
// for the whole session by design: the runtime cache never rebuilds on its
// own, buildSessionContext() always returns the corrected live truth, and the
// walk is cheap. When the runtime DOES rebuild (compaction, branch navigation),
// the replacement is a harmless no-op: both lists hold the same messages. The
// swap can never drop the current prompt: the agent loop persists every initial
// message at its message_end (agent-loop.js:52-54, agent-session.js:409-415)
// before the turn's first LLM request, so the fresh build already contains it.

import { existsSync } from "node:fs";
import type { ContextEventResult, ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import {
	decideContextSwap,
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
	// The live context build (session-manager.js:1000-1002). Returns the real
	// SessionContext; the structural view keeps the extension decoupled from the
	// full type. SwapMessage is exactly the element type a context handler may
	// return (ContextEventResult.messages), so the replacement type-checks.
	buildSessionContext(): { messages: SwapMessage[] };
}

// Element type of ContextEventResult.messages: what a "context" handler hands back.
type SwapMessage = NonNullable<ContextEventResult["messages"]>[number];

let lastCheck: SessionguardCheck | null = null;
// Armed when an entry check gains entries. Module-level on purpose: it survives
// /reload because pi caches the extension factory per cache token and re-runs the
// SAME factory on the new runner (loader.js extensionCache, moduleCache:false),
// so the flag and both handlers share one closure. Once armed it stays armed for
// the whole session: there is no un-arm path, because after a runtime rebuild
// (compaction, branch navigation) the swap degrades to a harmless no-op by
// content equality, never to a wrong answer.
let recovered = false;

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
	if (decision.gainedEntries > 0) {
		// The runtime list is now provably stale (it predates the gained entries
		// and rebuilds only at compaction/branch navigation): arm the context swap.
		recovered = true;
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

	// First-turn context rebuild (see the header comment). Fires before every LLM
	// call; zero interference while disarmed, wholesale replacement while armed.
	pi.on("context", (_event, ctx) => {
		if (!recovered) {
			return undefined;
		}
		const sm = ctx.sessionManager as unknown as ReloadableSessionManager;
		let fresh: SwapMessage[];
		try {
			fresh = sm.buildSessionContext().messages;
		} catch (error) {
			console.error("sessionguard: buildSessionContext failed; leaving the model context untouched:", error);
			return undefined;
		}
		const decision = decideContextSwap(recovered, fresh);
		return decision.swap ? { messages: decision.messages } : undefined;
	});

	pi.registerCommand("sessionguard", {
		description: "Report the last sessionguard flush-race check (leaf, entries gained, timestamp)",
		handler: (_args, ctx) => {
			ctx.ui.notify(formatCheckReport(lastCheck), "info");
		},
	});
}
