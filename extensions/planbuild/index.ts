// planbuild: opencode-style plan/build modes with the full opencode plan posture.
// Mode lifecycle: each turn's gate mode is derived from the stamps preceding that turn's
// user message on the live session branch (see ./modelifecycle.ts); switches apply to new
// messages only. Queued turns gate the same way even though pi skips the turn-start hook
// for them. Plan posture, mode UX and reminder delivery adapted from opencode v1.19.5
// (MIT, github.com/anomalyco/opencode): plan mode gates ONLY file writes outside
// .pi/plans/ and implementation-worker dispatch; everything else runs silently. The plan
// speech rides every model call ephemerally via the context event (see ./reminders.ts);
// nothing is persisted to the transcript.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { evaluatePlanModeToolCall } from "./posture.ts";
import { BUILD_SWITCH_SPEECH, PLAN_SPEECH, appendEphemeralSpeech } from "./reminders.ts";
import {
	NO_ANSWER_TEXT,
	PLAN_EXIT_NOT_APPROVED_TEXT,
	questionTimeoutSeconds,
	withDialogTimeout,
} from "./timeout.ts";
import {
	createPostApprovalOverride,
	deriveModeForTurn,
	derivePreviousTurnMode,
	deriveTurnMode,
	MODE_ENTRY_TYPE,
	resolveGateMode,
	type Mode,
} from "./modelifecycle.ts";

interface PlanbuildConfig {
	defaultMode?: Mode;
	// Dialog timeout in whole seconds for plan_question (select and input) and
	// the plan_exit approval confirm. Default 300; invalid values fall back to
	// the default (see timeout.ts questionTimeoutSeconds).
	questionTimeoutSeconds?: number;
	// Retired keys are ignored harmlessly by this parser: extraSafeShellCommands
	// (the retired shell gate), planAllowServers and planAllowTools (the retired
	// MCP classifier doors). The full opencode posture left nothing for them to
	// admit; stale entries in an existing planbuild.json do nothing.
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "planbuild.json");

function loadConfig(): PlanbuildConfig {
	if (!existsSync(CONFIG_PATH)) return {};
	try {
		const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8")) as PlanbuildConfig | null;
		if (!parsed || typeof parsed !== "object") return {};
		return parsed;
	} catch {
		return {};
	}
}

export default function planbuildExtension(pi: ExtensionAPI): void {
	const config = loadConfig();
	// Post-approval override (plan_exit race fix, plan part 3): set when the user
	// approves plan_exit, cleared at each turn start in before_agent_start. While
	// active, the gate treats the remainder of the turn as build even though the
	// steered approval message may not have landed (and re-anchored derivation)
	// yet. State machine unit-tested in modelifecycle.
	const postApprovalOverride = createPostApprovalOverride();
	// Gate mode memoization, keyed to the turn's anchor user message. pi 0.86.1 delivers
	// queued turns (input typed or steered while another turn streams) without emitting
	// before_agent_start, so freezing once per agent run leaves queued turns with a stale
	// mode. Instead: a queued turn's user message IS on the live branch before its turn
	// runs, and a flip pressed before that delivery stamps earlier on the branch, so the
	// mode is re-derived whenever the anchor user message changes. A mid-turn flip stamps
	// after the anchor and still cannot affect the running turn. null anchor means "no
	// user message seen yet"; the next reader derives fresh.
	let turnAnchorId: string | null = null;
	let turnMode: Mode | null = null;

	function configDefaultMode(): Mode {
		return config.defaultMode === "plan" ? "plan" : "build";
	}

	interface BranchEntry {
		id?: string;
		type: string;
		customType?: string;
		data?: { mode?: string } | Record<string, unknown>;
		message?: { role?: string };
	}

	function liveBranchEntries(ctx: ExtensionContext): BranchEntry[] {
		// getBranch() already returns chronological order (oldest first), verified against
		// pi 0.86.1 source (dist/core/session-manager.js walks leaf-to-root then reverses).
		// Only live-branch entries are consulted, so stamps on abandoned branches after an
		// edit are never seen here.
		return ctx.sessionManager.getBranch().slice() as BranchEntry[];
	}

	function lastUserMessageId(entries: BranchEntry[]): string | null {
		for (let i = entries.length - 1; i >= 0; i--) {
			const entry = entries[i];
			if (entry.type === "message" && entry.message?.role === "user") return entry.id ?? null;
		}
		return null;
	}

	function nextTurnMode(ctx: ExtensionContext): Mode {
		// Mode the NEXT message will run under: nearest preceding stamp on the live branch.
		return deriveTurnMode(liveBranchEntries(ctx), configDefaultMode());
	}

	function currentMode(ctx: ExtensionContext): Mode {
		// Post-approval override first (plan part 3): build for the rest of the
		// approval turn regardless of the anchor, cleared at the next turn start.
		if (postApprovalOverride.isActive()) return "build";
		// Gate mode for the running turn: anchored at the last user message on the live
		// branch and re-derived only when that anchor changes, so every direct AND queued
		// turn gates on the stamps preceding its own user message.
		const branch = liveBranchEntries(ctx);
		const anchorId = lastUserMessageId(branch);
		if (anchorId === null || anchorId !== turnAnchorId) {
			turnAnchorId = anchorId;
			turnMode = deriveModeForTurn(branch, configDefaultMode());
		}
		return resolveGateMode(postApprovalOverride, turnMode as Mode);
	}

	function updateStatus(ctx: ExtensionContext, display: Mode): void {
		if (display === "plan") {
			ctx.ui.setStatus("planbuild", ctx.ui.theme.fg("warning", "plan mode"));
		} else {
			ctx.ui.setStatus("planbuild", ctx.ui.theme.fg("muted", "build mode"));
		}
	}

	function setMode(next: Mode, ctx: ExtensionContext): void {
		// The stamp log is the source of truth: stamp when the target differs from the
		// last stamp on the live branch (fallback derivation included).
		if (nextTurnMode(ctx) !== next) {
			pi.appendEntry(MODE_ENTRY_TYPE, { mode: next });
		}
		// Status shows the derived NEXT-turn mode; the running turn keeps its anchored mode.
		// The model-facing flip notice is NOT persisted and NOT queued here: the build-switch
		// speech is delivered ephemerally on the first build turn's model calls (context
		// event, see reminders.ts), and the plan speech on every plan-mode call.
		updateStatus(ctx, next);
		if (next === "build") {
			ctx.ui.notify("Build mode: full access enabled.", "info");
		} else {
			ctx.ui.notify("Plan mode: read-only. Writes are limited to .pi/plans/ files.", "warning");
		}
	}

	function toggleMode(ctx: ExtensionContext): void {
		// Bare switches apply to new messages only; flip relative to the next-turn mode.
		setMode(nextTurnMode(ctx) === "plan" ? "build" : "plan", ctx);
	}

	pi.registerFlag("plan", {
		description: "Start in plan mode (read-only)",
		type: "boolean",
		default: false,
	});

	pi.registerFlag("build", {
		description: "Start in build mode (full access)",
		type: "boolean",
		default: false,
	});

	pi.registerCommand("mode", {
		description: "Switch plan/build mode: /mode plan, /mode build, /mode toggle",
		handler: async (args, ctx) => {
			const arg = (args ?? "").trim().toLowerCase();
			if (arg === "plan") setMode("plan", ctx);
			else if (arg === "build") setMode("build", ctx);
			else if (arg === "toggle") toggleMode(ctx);
			else ctx.ui.notify(`Current mode: ${nextTurnMode(ctx)}. Usage: /mode plan | /mode build | /mode toggle`, "info");
		},
	});

	pi.registerShortcut("alt+m", {
		description: "Toggle plan/build mode",
		handler: async (ctx) => toggleMode(ctx),
	});

	pi.registerTool({
		name: "plan_question",
		label: "Plan Question",
		description: "Ask the user a question and return their answer.",
		promptSnippet: "Ask the user a clarifying question and get the answer",
		promptGuidelines: [
			"Use plan_question when you need the user to clarify requirements or choose between trade-offs.",
		],
		parameters: Type.Object({
			question: Type.String({ description: "The question to ask" }),
			options: Type.Optional(Type.Array(Type.String(), { description: "Optional answer choices" })),
		}),
		async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
			if (!ctx.hasUI) {
				return {
					content: [{ type: "text", text: "No interactive UI is available, so the question was not asked." }],
					details: {},
				};
			}
			// Both boxes auto-dismiss after the configured timeout (native pi dialog
			// timeout with live countdown; see timeout.ts). A timeout is NOT an answer:
			// it is reported back as such and never selects anything.
			const timeoutSeconds = questionTimeoutSeconds(config);
			let outcome: { value: string | undefined; timedOut: boolean };
			if (params.options && params.options.length > 0) {
				outcome = await withDialogTimeout(
					(opts) => ctx.ui.select(params.question, params.options as string[], opts),
					timeoutSeconds,
				);
			} else {
				outcome = await withDialogTimeout(
					(opts) => ctx.ui.input(params.question, "", opts),
					timeoutSeconds,
				);
			}
			if (outcome.timedOut || outcome.value === undefined) {
				// Timeout and Esc dismissal share the same not-a-verdict result (plan part
				// 4): no decision was given, this is not a no, and the model must say in
				// chat what was asked and either proceed with a stated default or ask
				// again in plain chat. It never picks an option or invents text.
				return {
					content: [{ type: "text", text: NO_ANSWER_TEXT }],
					details: { answer: "(no answer)", timedOut: outcome.timedOut, timeoutSeconds },
				};
			}
			return { content: [{ type: "text", text: `User answer: ${outcome.value}` }], details: { answer: outcome.value } };
		},
	});

	pi.registerTool({
		name: "plan_exit",
		label: "Plan Exit",
		description: "Ask the user to approve the plan and switch to build mode. Plan mode only.",
		promptSnippet: "Request plan approval and switch to build mode",
		promptGuidelines: [
			"Use plan_exit when the plan is complete and you want the user to approve switching to build mode.",
		],
		parameters: Type.Object({}),
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			if (currentMode(ctx) !== "plan") {
				return {
					content: [{ type: "text", text: "plan_exit is only available in plan mode." }],
					details: {},
				};
			}
			if (!ctx.hasUI) {
				return {
					content: [{
						type: "text",
						text: "Cannot switch to build mode: no interactive UI is available to confirm the switch. The session stays in plan mode.",
					}],
					details: {},
				};
			}
			// The approval confirm auto-dismisses after the same configured timeout
			// (see plan_question above). A timeout is NEVER an approval: it lands in
			// the same not-a-verdict path as a dismissal, so the session stays in
			// plan mode.
			const timeoutSeconds = questionTimeoutSeconds(config);
			const outcome = await withDialogTimeout(
				(opts) => ctx.ui.confirm(
					"Switch to build mode?",
					"Plan complete. Switch to build mode and start implementing?",
					opts,
				),
				timeoutSeconds,
			);
			if (outcome.timedOut || outcome.value !== true) {
				// Dismissal and timeout are NOT a verdict on the plan (plan part 4): the
				// result says no decision was given, the session stays in plan mode, and
				// the model tells the user the approval is still pending. The old "User
				// rejected" wording is removed: it guessed intent from a keystroke.
				return {
					content: [{ type: "text", text: PLAN_EXIT_NOT_APPROVED_TEXT }],
					details: { approved: false, timedOut: outcome.timedOut, timeoutSeconds },
				};
			}
			setMode("build", ctx);
			// Push the running turn with a user-role steer message: it lands on the branch as
			// a message[user] entry (sendUserMessage routes through prompt(streamingBehavior
			// "steer") -> agent.steer({ role: "user" })), i.e. a new anchor, so the execute
			// phase that follows derives build from the stamp just appended. A steered custom
			// message would persist as custom_message, which is not an anchor.
			pi.sendUserMessage("The plan has been approved. Execute the plan now.", { deliverAs: "steer" });
			// Post-approval override (plan part 3): the dispatch the model makes right
			// after this approval may run BEFORE the steered approval message lands, so
			// anchor derivation could still read plan. The override gates the rest of
			// this turn as build; before_agent_start clears it for the next turn. The
			// anchor invalidation below stays: once the steered message lands it becomes
			// the new anchor and normal derivation resumes from the fresh stamp.
			postApprovalOverride.activate();
			// Invalidate the anchor memo so the next reader derives fresh from the branch
			// (belt and braces: the steer message changes the anchor once it lands).
			turnAnchorId = null;
			turnMode = null;
			return {
				content: [{ type: "text", text: "User approved switching to build mode. Wait for further instructions." }],
				details: {},
			};
		},
	});

	pi.on("tool_call", async (event, ctx) => {
		const gateMode = currentMode(ctx);
		if (event.toolName === "plan_exit" && gateMode === "build") {
			return { block: true, reason: "plan_exit is only available in plan mode." };
		}
		if (gateMode === "build") return;
		// Plan mode from here. Full opencode posture (user decision 2026-11-07):
		// the ONLY gates are the two in posture.ts, file writes outside .pi/plans/
		// and implementation-worker dispatch. Everything else (bash, powershell,
		// every mcp__<server> proxy including known mutators, the mcp gateway,
		// unknown tools, web, background, fusion, mcpScript, todo) is allowed
		// silently. There is no ask path: evaluatePlanModeToolCall returns null
		// (allow) or a hard block, never a permission popup request.
		const verdict = evaluatePlanModeToolCall(event.toolName, event.input as Record<string, unknown> | undefined, ctx.cwd);
		if (verdict) return verdict;
	});

	pi.on("context", async (event, ctx) => {
		// Ephemeral reminder delivery, ported from opencode session/reminders.ts:
		// pi fires this before EVERY LLM call (direct turns, steered continuations
		// and queued follow-ups alike: the agent loop drains those queues inside the
		// same run and routes each call through this event), with a deep copy of the
		// messages that exists only for THIS call. Appending a text part to the
		// current turn's user message therefore reaches the model without persisting
		// anything: no custom entries, no custom_message parts, nothing appended to
		// the session file.
		const gateMode = currentMode(ctx);
		if (gateMode === "plan") {
			if (appendEphemeralSpeech(event.messages, PLAN_SPEECH)) return { messages: event.messages };
			return;
		}
		// One-shot build-switch speech: rides every model call of the FIRST build
		// turn after a plan turn (previous anchor derives plan), statelessly derived
		// from the branch stamps, so consecutive build turns inject nothing.
		if (derivePreviousTurnMode(liveBranchEntries(ctx), configDefaultMode()) === "plan") {
			if (appendEphemeralSpeech(event.messages, BUILD_SWITCH_SPEECH)) return { messages: event.messages };
		}
	});

	pi.on("before_agent_start", async () => {
		// Post-approval override clears at every turn start (plan part 3): it only
		// ever covers the remainder of the approval turn. The steered approval
		// message is the new anchor from the next turn on, so plain derivation
		// (build) takes over seamlessly. The old display-only plan banner was
		// removed with the full posture: the plan speech now rides every model call
		// ephemerally (context handler above), which also covers queued turns the
		// turn-start hook never sees.
		postApprovalOverride.clear();
	});

	pi.on("session_start", async (_event, ctx) => {
		const flagPlan = pi.getFlag("plan") === true;
		const flagBuild = pi.getFlag("build") === true;
		if (flagPlan || flagBuild) {
			// Explicit flags append a stamp (like any switch), never derive from getEntries().
			const flagged: Mode = flagPlan ? "plan" : "build";
			if (nextTurnMode(ctx) !== flagged) {
				pi.appendEntry(MODE_ENTRY_TYPE, { mode: flagged });
			}
			updateStatus(ctx, flagged);
		} else {
			updateStatus(ctx, nextTurnMode(ctx));
		}
	});
}
