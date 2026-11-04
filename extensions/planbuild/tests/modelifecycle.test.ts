import test from "node:test";
import assert from "node:assert/strict";
import { deriveTurnMode, MODE_ENTRY_TYPE } from "../modelifecycle.ts";

function stamp(mode: string) {
  return { type: "custom", customType: MODE_ENTRY_TYPE, data: { mode } };
}

function msg() {
  return { type: "message" };
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
