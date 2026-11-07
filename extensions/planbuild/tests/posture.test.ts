import test from "node:test";
import assert from "node:assert/strict";
import { evaluatePlanModeToolCall, PLAN_ALLOWED_AGENTS, planPathAllowed, SUBAGENT_TOOL_NAME } from "../posture.ts";

const CWD = "C:/tmp/project";

function denyOnly(verdict: { block: true; reason: string } | null): string | null {
  // The gate's only two shapes: silent allow (null) or a hard block. This helper
  // asserts no third shape (an ask/popup path) can ever leak in.
  if (verdict === null) return null;
  assert.equal(verdict.block, true);
  return verdict.reason;
}

// ---------------------------------------------------------------------------
// Plan files: edit and write are the only file gates, .pi/plans/ allowed.
// ---------------------------------------------------------------------------

test("planPathAllowed: plan paths under .pi/plans pass, others fail", () => {
  assert.equal(planPathAllowed(".pi/plans/auth-refactor.md", CWD), true);
  assert.equal(planPathAllowed("@.pi/plans/my-plan.md", CWD), true);
  assert.equal(planPathAllowed("C:/tmp/project/.pi/plans/deep/nested.md", CWD), true);
  assert.equal(planPathAllowed("C:\\tmp\\project\\.pi\\plans\\win.md", CWD), true);
  assert.equal(planPathAllowed(".PI/PLANS/CASE.md", CWD), true);
  assert.equal(planPathAllowed("src/index.ts", CWD), false);
  assert.equal(planPathAllowed("C:/tmp/project/src/index.ts", CWD), false);
  assert.equal(planPathAllowed("", CWD), false);
  assert.equal(planPathAllowed("   ", CWD), false);
  assert.equal(planPathAllowed(".pi/plans", CWD), false);
});

test("edit and write deny outside .pi/plans with the switch-to-build reason", () => {
  for (const tool of ["edit", "write"]) {
    const verdict = denyOnly(evaluatePlanModeToolCall(tool, { path: "src/index.ts" }, CWD));
    assert.ok(verdict, `${tool} outside plans must block`);
    assert.ok(verdict.includes("writes outside .pi/plans/ are blocked"), verdict);
    assert.ok(verdict.includes("src/index.ts"), verdict);
    assert.ok(verdict.includes("/mode build"), verdict);
  }
});

test("edit and write allow .pi/plans plan files silently", () => {
  assert.equal(denyOnly(evaluatePlanModeToolCall("edit", { path: ".pi/plans/plan.md" }, CWD)), null);
  assert.equal(denyOnly(evaluatePlanModeToolCall("write", { path: "C:/tmp/project/.pi/plans/plan.md" }, CWD)), null);
});

test("edit and write with a missing path deny", () => {
  for (const tool of ["edit", "write"]) {
    assert.ok(denyOnly(evaluatePlanModeToolCall(tool, {}, CWD)), `${tool} with no path must block`);
    assert.ok(denyOnly(evaluatePlanModeToolCall(tool, { path: 42 }, CWD)), `${tool} with a non-string path must block`);
    assert.ok(denyOnly(evaluatePlanModeToolCall(tool, undefined, CWD)), `${tool} with no input must block`);
  }
});

// ---------------------------------------------------------------------------
// Subagent dispatch: the implementation worker is the only named deny.
// ---------------------------------------------------------------------------

test("worker dispatch denies with the research-agents reason", () => {
  const verdict = denyOnly(evaluatePlanModeToolCall(SUBAGENT_TOOL_NAME, { agent: "worker" }, CWD));
  assert.ok(verdict, "worker dispatch must block");
  assert.ok(verdict.includes("scout, researcher, reviewer, oracle, delegate"), verdict);
  assert.ok(verdict.includes("/mode build"), verdict);
});

test("unknown and missing agent names deny", () => {
  assert.ok(denyOnly(evaluatePlanModeToolCall(SUBAGENT_TOOL_NAME, { agent: "evil-agent" }, CWD)));
  assert.ok(denyOnly(evaluatePlanModeToolCall(SUBAGENT_TOOL_NAME, {}, CWD)));
  assert.ok(denyOnly(evaluatePlanModeToolCall(SUBAGENT_TOOL_NAME, { agent: "  " }, CWD)));
  assert.ok(denyOnly(evaluatePlanModeToolCall(SUBAGENT_TOOL_NAME, { agent: 7 }, CWD)));
});

test("research agents dispatch freely", () => {
  assert.equal(denyOnly(evaluatePlanModeToolCall(SUBAGENT_TOOL_NAME, { agent: "scout" }, CWD)), null);
  assert.equal(denyOnly(evaluatePlanModeToolCall(SUBAGENT_TOOL_NAME, { agent: "researcher" }, CWD)), null);
  assert.equal(denyOnly(evaluatePlanModeToolCall(SUBAGENT_TOOL_NAME, { agent: "reviewer" }, CWD)), null);
  assert.equal(denyOnly(evaluatePlanModeToolCall(SUBAGENT_TOOL_NAME, { agent: "oracle" }, CWD)), null);
  assert.equal(denyOnly(evaluatePlanModeToolCall(SUBAGENT_TOOL_NAME, { agent: "delegate" }, CWD)), null);
  assert.deepEqual([...PLAN_ALLOWED_AGENTS].sort(), ["delegate", "oracle", "researcher", "reviewer", "scout"]);
});

// ---------------------------------------------------------------------------
// Full posture: everything else is allowed silently. Zero ask paths.
// ---------------------------------------------------------------------------

test("bash and powershell run unrestricted in plan mode", () => {
  // Mutating commands included on purpose: the gate no longer inspects commands.
  // The strict plan speech (reminders.ts) is the fence, exactly like opencode.
  assert.equal(denyOnly(evaluatePlanModeToolCall("bash", { command: "rm -rf /" }, CWD)), null);
  assert.equal(denyOnly(evaluatePlanModeToolCall("bash", { command: "echo patched > src/x.ts" }, CWD)), null);
  assert.equal(denyOnly(evaluatePlanModeToolCall("powershell", { command: "Remove-Item -Recurse C:/x" }, CWD)), null);
  assert.equal(denyOnly(evaluatePlanModeToolCall("powershell", { command: "Set-Content f.txt hi" }, CWD)), null);
});

test("every MCP proxy call is allowed silently, known mutators included", () => {
  const calls: Array<[string, Record<string, unknown>]> = [
    ["mcp__serena", { tool: "edit_memory" }],
    ["mcp__serena", { tool: "serena_write_memory" }],
    ["mcp__github", { tool: "push_files" }],
    ["mcp__supabase", { tool: "execute_sql" }],
    ["mcp__photoshop", { tool: "save_psd" }],
    ["mcp__unknown-server", { tool: "anything" }],
    ["mcp__unknown-server", {}],
    ["mcp", { tool: "call", args: { server: "serena" } }],
  ];
  for (const [toolName, input] of calls) {
    assert.equal(denyOnly(evaluatePlanModeToolCall(toolName, input, CWD)), null, toolName);
  }
});

test("unknown tools, web tools, background and fusion tools all pass silently", () => {
  const names = [
    "totally_unknown_extension_tool",
    "web_search",
    "fetch_content",
    "get_search_content",
    "source_check",
    "web_enable",
    "bg_run",
    "bg_delegate",
    "bg_wait",
    "fusion_reason",
    "fusion_investigate",
    "mcpScript",
    "todowrite",
    "todo_write",
    "subagents_enable",
    "read",
    "grep",
    "find",
    "ls",
    "plan_question",
    "plan_exit",
  ];
  for (const name of names) {
    assert.equal(denyOnly(evaluatePlanModeToolCall(name, {}, CWD)), null, name);
  }
});

test("no ask path exists: the verdict is null or a hard block, never anything else", () => {
  const matrix: Array<[string, Record<string, unknown> | undefined]> = [
    ["edit", { path: "src/x.ts" }],
    ["edit", { path: ".pi/plans/x.md" }],
    ["write", { path: "src/x.ts" }],
    ["subagent", { agent: "worker" }],
    ["subagent", { agent: "scout" }],
    ["bash", { command: "git push" }],
    ["powershell", { command: "Remove-Item x" }],
    ["mcp__serena", { tool: "delete_memory" }],
    ["mcp", { tool: "call" }],
    ["mystery_tool", {}],
    ["plan_exit", {}],
  ];
  for (const [toolName, input] of matrix) {
    const verdict = evaluatePlanModeToolCall(toolName, input, CWD);
    assert.ok(verdict === null || (typeof verdict === "object" && verdict.block === true && typeof verdict.reason === "string"));
    // The structural assertion: no verdict shape carries an interactive prompt.
    assert.equal(JSON.stringify(verdict)?.includes('"ask"'), false, toolName);
  }
});

test("build mode is out of scope for the posture evaluator", () => {
  // index.ts returns before consulting the gate in build mode; the evaluator has
  // no build-mode behavior of its own to test. Guarded by a trivial canary: the
  // evaluator never mentions build mode outside the two deny reasons.
  assert.equal(evaluatePlanModeToolCall("bash", { command: "anything" }, CWD), null);
});
