// planbuild plan-mode posture: the ONLY plan-mode gates, full opencode parity.
// Pure module: no Pi imports.

import { resolve } from "node:path";
//
// User decision 2026-11-07 (full opencode posture): plan mode enforces exactly
// opencode's plan agent rules and nothing more:
//   1. edit and write are DENIED everywhere except plan files under .pi/plans/
//      (opencode: edit deny with plan-file allow patterns; write maps to edit).
//   2. Subagent dispatch of the implementation worker is DENIED (opencode denies
//      task.general, the general implementer; scout/researcher/reviewer/oracle/
//      delegate stay allowed, matching opencode allowing explore).
//   EVERYTHING ELSE is allowed silently: bash and powershell unrestricted, all
//   MCP tools (including known mutators), unknown tools, web tools, background
//   and fusion tools, mcpScript, todo tools. Zero ask paths remain: this module
//   can only return null (silent allow) or a hard block, never a popup request.
// In build mode nothing is gated (the caller returns before consulting this).
// The strict speech injected per model call (see ./reminders.ts) is the fence
// for everything the gate allows silently, exactly like opencode's plan.txt.

export const SUBAGENT_TOOL_NAME = "subagent";

// Research agents allowed in plan mode; the implementation worker (worker) and
// any unknown or unnamed agent are denied.
export const PLAN_ALLOWED_AGENTS = new Set(["scout", "researcher", "reviewer", "oracle", "delegate"]);

// Plan files live under this path segment (forward slashes; the check is
// case-insensitive on both sides).
const PLAN_DIR_SEGMENT = "/.pi/plans/";

// A hard block is the only denial shape: { block: true, reason }. null means
// allowed silently. There is no ask variant, so a plan-mode tool call can never
// open a permission popup.
export type PlanGateVerdict = { block: true; reason: string } | null;

export function planPathAllowed(rawPath: string, cwd: string): boolean {
	const stripped = rawPath.trim().replace(/^@/, "").replaceAll("\\", "/");
	if (!stripped) return false;
	const absolute = resolvePlanPath(cwd, stripped);
	return absolute.includes(PLAN_DIR_SEGMENT);
}

function resolvePlanPath(cwd: string, stripped: string): string {
	// Same resolve + backslash normalization as the previous inline index.ts
	// helper; behavior is unchanged.
	return resolve(cwd, stripped).replaceAll("\\", "/").toLowerCase();
}

// The plan-mode gate for one tool call. Structured, input-dependent checks only;
// the caller (index.ts) handles the mode-derived plan_exit guard in build mode.
export function evaluatePlanModeToolCall(
	toolName: string,
	input: Record<string, unknown> | undefined,
	cwd: string,
): PlanGateVerdict {
	if (toolName === "edit" || toolName === "write") {
		const rawPath = typeof input?.path === "string" ? input.path : "";
		if (!planPathAllowed(rawPath, cwd)) {
			return {
				block: true,
				reason: `Plan mode: writes outside .pi/plans/ are blocked (path: ${rawPath || "(missing)"}). Write your plan to a file under .pi/plans/ or switch to build mode with /mode build.`,
			};
		}
		return null;
	}

	if (toolName === SUBAGENT_TOOL_NAME) {
		const agent = typeof input?.agent === "string" ? input.agent.trim() : "";
		if (!PLAN_ALLOWED_AGENTS.has(agent)) {
			return {
				block: true,
				reason: `Plan mode: subagent dispatch of "${agent || "(no agent name)"}" is denied. Only research agents (scout, researcher, reviewer, oracle, delegate) may run in plan mode; switch to build mode with /mode build for full dispatch.`,
			};
		}
		return null;
	}

	// Everything else is allowed silently in plan mode (full opencode posture):
	// bash, powershell, every mcp__<server> proxy including known mutators, the
	// mcp gateway, unknown extension tools, web, background, fusion, mcpScript,
	// todo, plan_question and plan_exit.
	return null;
}
