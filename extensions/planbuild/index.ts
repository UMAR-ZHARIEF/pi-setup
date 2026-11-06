// planbuild: opencode-style plan/build modes for pi with a strict plan-mode shell gate.
// Mode lifecycle: each turn's gate mode is derived from the stamps preceding that turn's
// user message on the live session branch (see ./modelifecycle.ts); switches apply to new
// messages only. Queued turns gate the same way even though pi skips the turn-start hook
// for them. Shell gate and mode UX adapted from opencode (MIT, github.com/anomalyco/opencode)
// and Pi's plan-mode example (MIT).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
	classifyMcpCall,
	classifyPlanModeTool,
	extractSubtool,
	PLAN_MODE_DENY_REASON,
	type PlanAllowConfig,
} from "./classify.ts";
import {
	NO_ANSWER_TEXT,
	PLAN_EXIT_NOT_APPROVED_TEXT,
	questionTimeoutSeconds,
	withDialogTimeout,
} from "./timeout.ts";
import { inspectBashCommand, inspectPowershellCommand, loadExtraSafeCommands } from "./shellgate.ts";
import {
	createPostApprovalOverride,
	deriveModeForTurn,
	deriveTurnMode,
	MODE_ENTRY_TYPE,
	resolveGateMode,
	type Mode,
} from "./modelifecycle.ts";

interface PlanbuildConfig extends PlanAllowConfig {
	defaultMode?: Mode;
	extraSafeShellCommands?: string[];
	// Dialog timeout in whole seconds for plan_question (select and input) and
	// the plan_exit approval confirm. Default 300; invalid values fall back to
	// the default (see timeout.ts questionTimeoutSeconds).
	questionTimeoutSeconds?: number;
	// planAllowServers and planAllowTools come from PlanAllowConfig (classify.ts):
	// the only onboarding doors for future reads, consulted before the built-in
	// MCP tiers. A config entry can only add allows, never unblock a classified
	// mutation. The old customRules key is removed: plan mode's non-MPC path is a
	// strict allow list plus catch-all deny, so generic engine rules have no
	// consumer anymore.
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "planbuild.json");
const PLAN_REMINDER_TYPE = "planbuild-plan-reminder";
const BUILD_SWITCH_TYPE = "planbuild-build-switch";
const SUBAGENT_TOOL_NAME = "subagent";
const PLAN_ALLOWED_AGENTS = new Set(["scout", "researcher", "reviewer", "oracle", "delegate"]);
const PLAN_DIR_SEGMENT = "/.pi/plans/";

const PLAN_REMINDER = `[PLAN MODE ACTIVE]
You are in plan mode, a read-only research phase. The user does not want execution yet.
This constraint supersedes other instructions you have received.

Hard limits enforced by the extension:
- File edits and writes are blocked everywhere except plan files under .pi/plans/ (use forward slashes, for example .pi/plans/auth-refactor.md).
- bash and powershell commands must be read-only; anything outside the read-only allowlist is blocked.
- Subagent dispatch is limited to research agents: scout, researcher, reviewer, oracle, delegate. Other agents such as worker are denied in plan mode; switch to build mode for full dispatch.
- Every other tool is denied in plan mode: only file reads, web search and fetch, research dispatch, and the plan tools below pass. Background and fusion tasks, mcpScript, todo tracking, and unknown extensions are unavailable; switch to build mode with /mode build for them.

Research, read, ask questions with the plan_question tool, and write your plan incrementally to a .pi/plans/ file. When the plan is complete, call plan_exit to ask the user to switch to build mode and execute the plan.`;

const BUILD_SWITCH = `[BUILD MODE ACTIVE]
Your operational mode has changed from plan to build.
You are no longer in read-only mode.
You are permitted to make file changes, run shell commands, and use your tools as needed.`;

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

	function setMode(
		next: Mode,
		ctx: ExtensionContext,
		options?: { deliver?: "steer" },
	): void {
		// The stamp log is the source of truth: stamp when the target differs from the
		// last stamp on the live branch (fallback derivation included).
		if (nextTurnMode(ctx) !== next) {
			pi.appendEntry(MODE_ENTRY_TYPE, { mode: next });
		}
		// Status shows the derived NEXT-turn mode; the running turn keeps its anchored mode.
		updateStatus(ctx, next);
		if (next === "build") {
			const message = { customType: BUILD_SWITCH_TYPE, content: BUILD_SWITCH, display: false };
			if (options?.deliver === "steer") {
				// plan_exit only: the approval must reach the RUNNING turn, so the notice
				// rides the steer queue and is injected into the live run (and persisted at
				// delivery) before the model's next response.
				pi.sendMessage(message, { deliverAs: "steer" });
			} else {
				// Command flips: never queue the notice nextTurn (pi drains nextTurn only
				// inside prompt(), which queued turns never reach: it would burst at the
				// next direct prompt and starve queued turns). triggerTurn:false writes it
				// immediately when idle and flushes it at the next turn boundary when
				// streaming, always before any queued continuation runs.
				pi.sendMessage(message, { triggerTurn: false });
			}
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
			setMode("build", ctx, { deliver: "steer" });
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

	function planPathAllowed(rawPath: string, cwd: string): boolean {
		const stripped = rawPath.trim().replace(/^@/, "").replaceAll("\\", "/");
		if (!stripped) return false;
		const absolute = resolve(cwd, stripped).replaceAll("\\", "/").toLowerCase();
		return absolute.includes(PLAN_DIR_SEGMENT);
	}

	pi.on("tool_call", async (event, ctx) => {
		const gateMode = currentMode(ctx);
		if (event.toolName === "plan_exit" && gateMode === "build") {
			return { block: true, reason: "plan_exit is only available in plan mode." };
		}
		if (gateMode === "build") return;
		// Plan mode from here: ZERO POPUPS by construction (plan part 2). Every
		// branch below returns an allow (undefined) or a block; the interactive ask
		// path is gone, so no plan-mode tool call can ever open a permission dialog.
		if (event.toolName === "plan_question" || event.toolName === "plan_exit") return;

		const input = event.input as Record<string, unknown>;

		if (event.toolName === "edit" || event.toolName === "write") {
			const rawPath = typeof input.path === "string" ? input.path : "";
			if (!planPathAllowed(rawPath, ctx.cwd)) {
				return {
					block: true,
					reason: `Plan mode: writes outside .pi/plans/ are blocked (path: ${rawPath || "(missing)"}). Write your plan to a file under .pi/plans/ or switch to build mode with /mode build.`,
				};
			}
			return;
		}

		if (event.toolName === "bash") {
			const command = typeof input.command === "string" ? input.command : "";
			const verdict = inspectBashCommand(command);
			if (!verdict.allowed) {
				return {
					block: true,
					reason: `Plan mode: bash command blocked by the read-only shell gate: ${verdict.reason}. Switch to build mode with /mode build to run arbitrary commands.`,
				};
			}
			return;
		}

		if (event.toolName === "powershell") {
			const command = typeof input.command === "string" ? input.command : "";
			const verdict = inspectPowershellCommand(command);
			if (!verdict.allowed) {
				return {
					block: true,
					reason: `Plan mode: powershell command blocked by the read-only shell gate: ${verdict.reason}. Switch to build mode with /mode build to run arbitrary commands.`,
				};
			}
			return;
		}

		if (event.toolName === SUBAGENT_TOOL_NAME) {
			const agent = typeof input.agent === "string" ? input.agent.trim() : "";
			if (!PLAN_ALLOWED_AGENTS.has(agent)) {
				return {
					block: true,
					reason: `Plan mode: subagent dispatch of "${agent || "(no agent name)"}" is denied. Only research agents (scout, researcher, reviewer, oracle, delegate) may run in plan mode; switch to build mode with /mode build for full dispatch.`,
				};
			}
			return;
		}

		// MCP tool-server calls arrive as namespace proxies: toolName "mcp__<server>",
		// input envelope {tool, args} (pi-mcp-adapter namespace-tools.ts; input.tool may
		// be the bare server tool name or a server-prefixed candidate spelling, both
		// normalized in classify.ts). Classified before the catch-all: the config
		// doors and the built-in read tiers pass silently and everything else
		// hard-denies with the classifier reason surfaced verbatim (zero popups: the
		// classifier never returns ask, user decision 2026-11-05), so mcp__ calls
		// never reach an interactive ask path.
		if (event.toolName.startsWith("mcp__")) {
			const server = event.toolName.slice("mcp__".length);
			const subtool = extractSubtool(input);
			const verdict = classifyMcpCall(server, subtool, config);
			if (verdict.action === "allow") return;
			if (verdict.action === "deny") {
				// Surface the classifier reason verbatim; reasons that already carry the
				// switch instruction (unclassified calls) are not doubled.
				const switchNote = verdict.reason.includes("switch to build mode")
					? ""
					: " Switch to build mode with /mode build.";
				return {
					block: true,
					reason: `Plan mode: ${event.toolName}.${subtool ?? "(unknown sub-tool)"}: ${verdict.reason}.${switchNote}`,
				};
			}
			// The classifier never returns "ask": the plan-mode path has no interactive
			// ask tier left (plan part 2 removed it together with customRules).
		}

		// Strict non-MPC catch-all (plan part 2): known reads (builtins, the
		// pi-web-access reading tools and their web_enable loader) pass silently;
		// EVERYTHING else (bg and fusion tools, mcpScript, todo, unknown extension
		// tools) denies with the switch-to-build message. No ask: zero popups.
		const toolVerdict = classifyPlanModeTool(event.toolName);
		if (toolVerdict.action === "allow") return;
		return {
			block: true,
			reason: `Plan mode: tool "${event.toolName}" is ${PLAN_MODE_DENY_REASON}.`,
		};
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		// Post-approval override clears at every turn start (plan part 3): it only
		// ever covers the remainder of the approval turn. The steered approval
		// message is the new anchor from the next turn on, so plain derivation
		// (build) takes over seamlessly.
		postApprovalOverride.clear();
		// Display-only plan reminder. Derived via nextTurnMode() (nearest preceding stamp):
		// pi appends the turn's user message to the branch only AFTER this hook fires, so
		// anchor-based derivation here would read the previous turn's anchor and show a
		// stale banner on the first turn and after between-turn flips. nearest-stamp now
		// exactly equals the anchor-based result once the imminent message lands. The
		// gate never depends on this banner: currentMode() re-derives per anchor at
		// tool_call time, which also covers queued turns that never fire this hook.
		if (nextTurnMode(ctx) === "plan") {
			return { message: { customType: PLAN_REMINDER_TYPE, content: PLAN_REMINDER, display: false } };
		}
	});

	pi.on("session_start", async (_event, ctx) => {
		loadExtraSafeCommands(CONFIG_PATH);
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
