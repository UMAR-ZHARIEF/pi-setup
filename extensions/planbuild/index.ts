// planbuild: opencode-style plan/build modes for pi with a strict plan-mode shell gate.
// Semantics ported from opencode v1.19.5 (MIT, github.com/anomalyco/opencode) and Pi's plan-mode example (MIT).

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { evaluate, mergeRuleSets, type Rule } from "./engine.ts";
import { inspectBashCommand, inspectPowershellCommand, loadExtraSafeCommands } from "./shellgate.ts";

type Mode = "plan" | "build";

interface PlanbuildConfig {
	defaultMode?: Mode;
	extraSafeShellCommands?: string[];
	customRules?: Rule[];
}

const CONFIG_PATH = join(homedir(), ".pi", "agent", "planbuild.json");
const MODE_ENTRY_TYPE = "planbuild-mode";
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

function customTypeOf(message: unknown): string | undefined {
	return (message as { customType?: string } | undefined)?.customType;
}

export default function planbuildExtension(pi: ExtensionAPI): void {
	const config = loadConfig();
	let mode: Mode = config.defaultMode === "plan" ? "plan" : "build";

	function rules(): Rule[] {
		const custom = Array.isArray(config.customRules) ? config.customRules : [];
		return mergeRuleSets(BUILTIN_RULES, custom);
	}

	function updateStatus(ctx: ExtensionContext): void {
		if (mode === "plan") {
			ctx.ui.setStatus("planbuild", ctx.ui.theme.fg("warning", "plan mode"));
		} else {
			ctx.ui.setStatus("planbuild", ctx.ui.theme.fg("muted", "build mode"));
		}
	}

	function persistMode(): void {
		pi.appendEntry(MODE_ENTRY_TYPE, { mode });
	}

	function setMode(
		next: Mode,
		ctx: ExtensionContext,
		options?: { extra?: string; deliver?: "steer" | "nextTurn" },
	): void {
		if (mode !== next) {
			mode = next;
			persistMode();
		}
		updateStatus(ctx);
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
		setMode(mode === "plan" ? "build" : "plan", ctx);
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
			else ctx.ui.notify(`Current mode: ${mode}. Usage: /mode plan | /mode build | /mode toggle`, "info");
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
			if (mode !== "plan") {
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
		if (event.toolName === "plan_exit" && mode === "build") {
			return { block: true, reason: "plan_exit is only available in plan mode." };
		}
		if (mode === "build") return;
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

	pi.on("before_agent_start", async () => {
		if (mode === "plan") {
			return { message: { customType: PLAN_REMINDER_TYPE, content: PLAN_REMINDER, display: false } };
		}
	});

	pi.on("context", async (event) => {
		const messages = event.messages;
		let lastPlan = -1;
		let lastSwitch = -1;
		for (let i = 0; i < messages.length; i++) {
			const customType = customTypeOf(messages[i]);
			if (customType === PLAN_REMINDER_TYPE) lastPlan = i;
			else if (customType === BUILD_SWITCH_TYPE) lastSwitch = i;
		}
		let changed = false;
		const filtered = messages.filter((message, index) => {
			const customType = customTypeOf(message);
			if (customType === PLAN_REMINDER_TYPE) {
				const keep = mode === "plan" && index === lastPlan;
				if (!keep) changed = true;
				return keep;
			}
			if (customType === BUILD_SWITCH_TYPE) {
				const keep = index === lastSwitch;
				if (!keep) changed = true;
				return keep;
			}
			return true;
		});
		if (!changed) return;
		return { messages: filtered };
	});

	pi.on("session_start", async (_event, ctx) => {
		loadExtraSafeCommands(CONFIG_PATH);
		const flagPlan = pi.getFlag("plan") === true;
		const flagBuild = pi.getFlag("build") === true;
		if (flagPlan) {
			mode = "plan";
		} else if (flagBuild) {
			mode = "build";
		} else {
			const entries = ctx.sessionManager.getEntries();
			const entry = entries
				.filter((e: { type: string; customType?: string }) => e.type === "custom" && e.customType === MODE_ENTRY_TYPE)
				.pop() as { data?: { mode?: Mode } } | undefined;
			const persisted = entry?.data?.mode;
			if (persisted === "plan" || persisted === "build") mode = persisted;
		}
		updateStatus(ctx);
	});
}
