// planbuild: opencode-style plan/build modes for pi with a strict plan-mode shell gate.
// Mode lifecycle: each turn derives its mode from the nearest preceding mode stamp on
// the live session branch (see ./modelifecycle.ts); switches apply to new messages only.
// Shell gate and mode UX adapted from opencode (MIT, github.com/anomalyco/opencode)
// and Pi's plan-mode example (MIT).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { evaluate, mergeRuleSets, type Rule } from "./engine.ts";
import { inspectBashCommand, inspectPowershellCommand, loadExtraSafeCommands } from "./shellgate.ts";
import { deriveTurnMode, MODE_ENTRY_TYPE, type Mode } from "./modelifecycle.ts";

interface PlanbuildConfig {
	defaultMode?: Mode;
	extraSafeShellCommands?: string[];
	customRules?: Rule[];
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "planbuild.json");
const PLAN_REMINDER_TYPE = "planbuild-plan-reminder";
const BUILD_SWITCH_TYPE = "planbuild-build-switch";
const SUBAGENT_TOOL_NAME = "subagent";
const PLAN_ALLOWED_AGENTS = new Set(["scout", "researcher", "reviewer", "oracle", "delegate"]);
const PLAN_DIR_SEGMENT = "/.pi/plans/";

const BUILTIN_RULES: Rule[] = [
	{ tool: "*", pattern: "*", action: "ask" },
	{ tool: "read", pattern: "*", action: "allow" },
	{ tool: "grep", pattern: "*", action: "allow" },
	{ tool: "find", pattern: "*", action: "allow" },
	{ tool: "ls", pattern: "*", action: "allow" },
	{ tool: "edit", pattern: "*", action: "deny" },
	{ tool: "edit", pattern: ".pi/plans/*", action: "allow" },
	{ tool: "write", pattern: "*", action: "deny" },
	{ tool: "write", pattern: ".pi/plans/*", action: "allow" },
	{ tool: "bash", pattern: "*", action: "deny" },
	{ tool: "powershell", pattern: "*", action: "deny" },
	{ tool: "subagent", pattern: "worker", action: "deny" },
	{ tool: "plan_exit", pattern: "*", action: "allow" },
];

const PLAN_REMINDER = `[PLAN MODE ACTIVE]
You are in plan mode, a read-only research phase. The user does not want execution yet.
This constraint supersedes other instructions you have received.

Hard limits enforced by the extension:
- File edits and writes are blocked everywhere except plan files under .pi/plans/ (use forward slashes, for example .pi/plans/auth-refactor.md).
- bash and powershell commands must be read-only; anything outside the read-only allowlist is blocked.
- Subagent dispatch is limited to research agents: scout, researcher, reviewer, oracle, delegate. Other agents such as worker are denied in plan mode; switch to build mode for full dispatch.

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
	// Mode of the currently running turn, frozen when the turn starts so a bare switch
	// mid-turn never applies retroactively. null means idle or invalidated by the
	// plan_exit approval; the next reader derives once and re-freezes.
	let turnMode: Mode | null = null;

	function configDefaultMode(): Mode {
		return config.defaultMode === "plan" ? "plan" : "build";
	}

	function liveBranchEntries(ctx: ExtensionContext): Array<{
		type: string;
		customType?: string;
		data?: { mode?: string } | Record<string, unknown>;
	}> {
		// getBranch() already returns chronological order (oldest first), verified against
		// pi 0.86.1 source (dist/core/session-manager.js walks leaf-to-root then reverses).
		// Only live-branch entries are consulted, so stamps on abandoned branches after an
		// edit are never seen here.
		return ctx.sessionManager.getBranch().slice() as Array<{
			type: string;
			customType?: string;
			data?: { mode?: string } | Record<string, unknown>;
		}>;
	}

	function nextTurnMode(ctx: ExtensionContext): Mode {
		// Mode the NEXT message will run under: nearest preceding stamp on the live branch.
		return deriveTurnMode(liveBranchEntries(ctx), configDefaultMode());
	}

	function currentMode(ctx: ExtensionContext): Mode {
		// Gate mode for the running turn: frozen at turn start, derived once on demand.
		if (turnMode === null) turnMode = nextTurnMode(ctx);
		return turnMode;
	}

	function rules(): Rule[] {
		const custom = Array.isArray(config.customRules) ? config.customRules : [];
		return mergeRuleSets(BUILTIN_RULES, custom);
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
		options?: { extra?: string; deliver?: "steer" | "nextTurn" },
	): void {
		// The stamp log is the source of truth: stamp when the target differs from the
		// last stamp on the live branch (fallback derivation included).
		if (nextTurnMode(ctx) !== next) {
			pi.appendEntry(MODE_ENTRY_TYPE, { mode: next });
		}
		// Status shows the derived NEXT-turn mode; the running turn keeps its frozen mode.
		updateStatus(ctx, next);
		if (next === "build") {
			const content = options?.extra ? `${BUILD_SWITCH}\n\n${options.extra}` : BUILD_SWITCH;
			pi.sendMessage(
				{ customType: BUILD_SWITCH_TYPE, content, display: false },
				{ deliverAs: options?.deliver ?? "nextTurn" },
			);
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
			let answer: string | undefined;
			if (params.options && params.options.length > 0) {
				answer = await ctx.ui.select(params.question, params.options);
			} else {
				answer = await ctx.ui.input(params.question, "");
			}
			const text = answer ?? "(dismissed)";
			return { content: [{ type: "text", text: `User answer: ${text}` }], details: { answer: text } };
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
			const approved = await ctx.ui.confirm(
				"Switch to build mode?",
				"Plan complete. Switch to build mode and start implementing?",
			);
			if (!approved) {
				return {
					content: [{
						type: "text",
						text: "User rejected the switch to build mode. Stay in plan mode and keep refining the plan.",
					}],
					details: {},
				};
			}
			setMode("build", ctx, {
				extra: "The plan has been approved. Execute the plan now.",
				deliver: "steer",
			});
			// Only path allowed to invalidate the frozen turn: the steer-delivered "execute
			// the plan" message is a new message inside this same run, so it must derive
			// build and pass the gate.
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

	function subjectFor(input: Record<string, unknown>): string {
		for (const key of ["path", "file_path", "filePath", "pattern", "query", "url"]) {
			const value = input[key];
			if (typeof value === "string" && value.trim().length > 0) return value;
		}
		return "*";
	}

	pi.on("tool_call", async (event, ctx) => {
		const gateMode = currentMode(ctx);
		if (event.toolName === "plan_exit" && gateMode === "build") {
			return { block: true, reason: "plan_exit is only available in plan mode." };
		}
		if (gateMode === "build") return;
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

		const action = evaluate(event.toolName, subjectFor(input), rules());
		if (action === "allow") return;
		const reason = `Plan mode: tool "${event.toolName}" (subject "${subjectFor(input)}") matched a ${action} rule.`;
		if (action === "deny") return { block: true, reason };
		if (!ctx.hasUI) {
			return { block: true, reason: `${reason} No interactive UI is available, so ask fails closed to deny.` };
		}
		const ok = await ctx.ui.confirm("Plan mode permission", `Allow tool "${event.toolName}" in plan mode?`);
		if (!ok) return { block: true, reason: `${reason} The user declined.` };
	});

	pi.on("before_agent_start", async (_event, ctx) => {
		// Freeze this turn's mode from the live branch: nearest preceding stamp wins.
		turnMode = deriveTurnMode(liveBranchEntries(ctx), configDefaultMode());
		if (turnMode === "plan") {
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
