import test from "node:test";
import assert from "node:assert/strict";
import { createPostApprovalOverride, deriveModeForTurn, deriveTurnMode, MODE_ENTRY_TYPE, resolveGateMode } from "../modelifecycle.ts";

function stamp(mode: string) {
  return { type: "custom", customType: MODE_ENTRY_TYPE, data: { mode } };
}

function msg() {
  return { type: "message" };
}

function user() {
  return { type: "message", message: { role: "user" } };
}

function assistant() {
  return { type: "message", message: { role: "assistant" } };
}

test("MODE_ENTRY_TYPE is the persisted stamp customType", () => {
  assert.equal(MODE_ENTRY_TYPE, "planbuild-mode");
});

test("no stamp falls back", () => {
  assert.equal(deriveTurnMode([], "plan"), "plan");
  assert.equal(deriveTurnMode([], "build"), "build");
  const entries = [msg(), msg(), { type: "usage" }];
  assert.equal(deriveTurnMode(entries, "plan"), "plan");
  assert.equal(deriveTurnMode(entries, "build"), "build");
});

test("later stamp wins per position", () => {
  const chronological = [stamp("plan"), stamp("build"), stamp("plan")];
  assert.equal(deriveTurnMode(chronological, "build"), "plan");
  // Same list truncated to two entries derives the mode at that position.
  assert.equal(deriveTurnMode(chronological.slice(0, 2), "plan"), "build");
});

test("walk is backwards, so the last entry decides", () => {
  assert.equal(deriveTurnMode([stamp("build"), stamp("plan")], "build"), "plan");
  assert.equal(deriveTurnMode([stamp("plan"), stamp("build")], "plan"), "build");
  assert.equal(deriveTurnMode([msg(), stamp("plan"), msg()], "build"), "plan");
});

test("dead branch does not win", () => {
  // Session tree after an edit: shared history up to the old leaf, and an abandoned
  // continuation carrying a NEWER build stamp that is no longer on the live branch.
  const shared = [stamp("plan"), msg()];
  const liveBranch = shared;
  const abandonedBranch = [...shared, msg(), stamp("build")];
  // Deriving from the live list only: the dead newer stamp is never consulted.
  assert.equal(deriveTurnMode(liveBranch, "build"), "plan");
  assert.equal(deriveTurnMode(abandonedBranch, "plan"), "build");
});

test("edit replay keeps the original mode", () => {
  // The user edits an old message: pi truncates the live branch before the reply
  // chain, so the replayed turn ends before the later build stamp.
  const liveBranch = [stamp("plan"), msg()];
  const abandonedContinuation = [stamp("plan"), msg(), msg(), stamp("build")];
  assert.equal(deriveTurnMode(liveBranch, "build"), "plan");
  assert.equal(deriveTurnMode(abandonedContinuation, "build"), "build");
});

test("unknown or malformed stamp values are skipped, not thrown", () => {
  const malformed = [
    { type: "custom", customType: MODE_ENTRY_TYPE }, // no data
    { type: "custom", customType: MODE_ENTRY_TYPE, data: {} }, // no mode key
    stamp("auto"), // unknown mode value
    { type: "custom", customType: MODE_ENTRY_TYPE, data: { mode: 42 } }, // wrong value type
    { type: "message", customType: MODE_ENTRY_TYPE, data: { mode: "plan" } }, // not a custom entry
    { type: "custom", customType: "other-extension", data: { mode: "plan" } }, // wrong customType
  ];
  assert.equal(deriveTurnMode(malformed, "build"), "build");
  assert.equal(deriveTurnMode(malformed, "plan"), "plan");
  // Valid stamps around malformed ones still win in position order.
  assert.equal(deriveTurnMode([stamp("plan"), ...malformed, stamp("build")], "plan"), "build");
  assert.equal(deriveTurnMode([stamp("build"), ...malformed, stamp("plan")], "build"), "plan");
});

test("deriveModeForTurn: no user message returns the fallback, even with stamps", () => {
  assert.equal(deriveModeForTurn([], "plan"), "plan");
  assert.equal(deriveModeForTurn([], "build"), "build");
  // Unlike deriveTurnMode, stamps without a user-message anchor do not decide anything.
  assert.equal(deriveModeForTurn([stamp("build"), stamp("build")], "plan"), "plan");
  assert.equal(deriveModeForTurn([msg(), assistant()], "build"), "build");
});

test("deriveModeForTurn: the stamp preceding the anchor user message wins", () => {
  assert.equal(deriveModeForTurn([stamp("build"), user()], "plan"), "build");
  assert.equal(deriveModeForTurn([stamp("plan"), user(), assistant()], "build"), "plan");
  // No stamp before the anchor falls back.
  assert.equal(deriveModeForTurn([user()], "plan"), "plan");
  assert.equal(deriveModeForTurn([user(), assistant(), stamp("build")], "plan"), "plan");
});

test("deriveModeForTurn: a stamp after the anchor user message is ignored", () => {
  // Mid-turn flip: the stamp lands after the turn's own user message, so it cannot
  // affect the turn that is already running.
  assert.equal(deriveModeForTurn([stamp("plan"), user(), assistant(), stamp("build")], "plan"), "plan");
  assert.equal(deriveModeForTurn([stamp("build"), user(), assistant(), stamp("plan")], "build"), "build");
});

test("deriveModeForTurn: queued shape, a flip stamped before the queued message applies to it", () => {
  // The queued turn's user message is the new anchor, and a stamp pressed while the
  // previous turn streamed precedes it on the branch, so it governs the queued turn.
  const queuedApplies = [stamp("build"), user(), assistant(), stamp("plan"), user()];
  assert.equal(deriveModeForTurn(queuedApplies, "build"), "plan");
  // A stamp pressed after the queued message was delivered does NOT apply to it.
  const queuedIgnores = [stamp("plan"), user(), assistant(), user(), stamp("build")];
  assert.equal(deriveModeForTurn(queuedIgnores, "build"), "plan");
});

test("deriveModeForTurn: malformed stamps between the anchor and a valid stamp are skipped", () => {
  const malformed = [
    { type: "custom", customType: MODE_ENTRY_TYPE }, // no data
    stamp("auto"), // unknown mode value
  ];
  assert.equal(deriveModeForTurn([stamp("plan"), user(), ...malformed, stamp("build"), user()], "plan"), "build");
  assert.equal(deriveModeForTurn([user(), ...malformed], "build"), "build");
});

test("deriveModeForTurn: only the last user message is the anchor", () => {
  assert.equal(deriveModeForTurn([stamp("plan"), user(), stamp("build"), user()], "plan"), "build");
  assert.equal(deriveModeForTurn([stamp("build"), user(), stamp("plan"), user()], "build"), "plan");
  // A stamp before an earlier user message still precedes the last one.
  assert.equal(deriveModeForTurn([stamp("plan"), user(), user(), assistant()], "build"), "plan");
});

test("deriveModeForTurn: reproduced phase-D cascade from the queued-turn bug report", () => {
  // pi 0.86.1 cascade: long build turn L, /mode plan stamped during L, queued write
  // attempt Q1, /mode build stamped during Q1, queued Q2. Under per-anchor derivation
  // Q1 must be plan (write blocked) and Q2 must be build (write allowed), while the
  // running turns keep the mode they started with.
  const branch = [
    stamp("build"), // D1 flipped to build
    user(), // L: "run a long command"
    assistant(),
    stamp("plan"), // /mode plan pressed while L streams
    user(), // Q1: queued write attempt
    assistant(),
    stamp("build"), // /mode build pressed while Q1 runs
    user(), // Q2: queued write attempt
    assistant(),
  ];
  // Turn L anchors at its own user message: stamp build precedes it.
  assert.equal(deriveModeForTurn(branch.slice(0, 3), "plan"), "build");
  // Q1 anchors at its queued user message (index 4): nearest preceding stamp is plan.
  assert.equal(deriveModeForTurn(branch.slice(0, 6), "build"), "plan");
  // Q2 anchors at its queued user message (index 7): nearest preceding stamp is build.
  assert.equal(deriveModeForTurn(branch, "plan"), "build");
});

// ---------------------------------------------------------------------------
// Post-approval override (plan part 3, plan_exit race fix): on approval the gate
// returns build for the remainder of the turn even though the anchor still derives
// plan; the override clears at the next turn start.
// ---------------------------------------------------------------------------

test("post-approval override is inactive in a fresh session", () => {
  const override = createPostApprovalOverride();
  assert.equal(override.isActive(), false);
  // Inactive override leaves every derived mode unchanged.
  assert.equal(resolveGateMode(override, "plan"), "plan");
  assert.equal(resolveGateMode(override, "build"), "build");
});

test("post-approval override gates build regardless of the anchor-derived mode", () => {
  const override = createPostApprovalOverride();
  override.activate();
  assert.equal(override.isActive(), true);
  // The approval-turn anchor still derives plan, but the gate returns build.
  assert.equal(resolveGateMode(override, "plan"), "build");
  assert.equal(resolveGateMode(override, "build"), "build");
});

test("post-approval override clears at the next turn start and derivation resumes", () => {
  const override = createPostApprovalOverride();
  override.activate();
  assert.equal(resolveGateMode(override, "plan"), "build");
  // before_agent_start of the next turn clears the flag; the steered approval
  // message re-anchored derivation to build, represented here by the derived value.
  override.clear();
  assert.equal(override.isActive(), false);
  assert.equal(resolveGateMode(override, "build"), "build");
});

test("post-approval override activate and clear are idempotent", () => {
  const override = createPostApprovalOverride();
  override.activate();
  override.activate();
  assert.equal(override.isActive(), true);
  override.clear();
  override.clear();
  assert.equal(override.isActive(), false);
});

test("post-approval override full plan_exit sequence reproduced", () => {
  // plan-era anchor derives plan; approval activates; next turn clears while the
  // stamp now derives build; nothing keeps the override alive past its turn.
  const override = createPostApprovalOverride();
  const anchorSaysPlan = "plan" as const;
  assert.equal(resolveGateMode(override, anchorSaysPlan), "plan");
  override.activate(); // plan_exit approved
  assert.equal(resolveGateMode(override, anchorSaysPlan), "build");
  override.clear(); // next before_agent_start
  assert.equal(resolveGateMode(override, "build"), "build");
});
