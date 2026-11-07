import test from "node:test";
import assert from "node:assert/strict";
import { appendEphemeralSpeech, BUILD_SWITCH_SPEECH, PLAN_SPEECH, type SpeechMessage } from "../reminders.ts";

test("plan speech carries the strict opencode wording", () => {
  // Adapted from opencode session/prompt/plan.txt (v1.19.5): the strict fence.
  // Whitespace-normalized: line wrapping must not hide a sentence.
  const flat = PLAN_SPEECH.replaceAll(/\s+/g, " ");
  assert.ok(flat.includes("READ-ONLY phase"), "read-only phase");
  assert.ok(flat.includes("STRICTLY FORBIDDEN"), "strictly forbidden");
  assert.ok(flat.includes("non-readonly command"), "non-readonly commands");
  assert.ok(flat.includes("overrides ALL other instructions"), "overrides all others");
  assert.ok(flat.includes("including direct user edit requests"), "direct user requests");
  assert.ok(flat.includes("ZERO exceptions"), "zero exceptions");
  assert.ok(flat.includes("This supersedes any other instructions"), "supersession");
});

test("plan speech carries the .pi/plans convention and the plan tools guidance", () => {
  assert.ok(PLAN_SPEECH.includes(".pi/plans/"), "plan-file convention");
  assert.ok(PLAN_SPEECH.includes("plan_question"), "plan_question guidance");
  assert.ok(PLAN_SPEECH.includes("plan_exit"), "plan_exit guidance");
  assert.ok(PLAN_SPEECH.includes("<system-reminder>"), "opencode-style envelope");
});

test("build-switch speech matches opencode's build-switch.txt adapted", () => {
  assert.ok(BUILD_SWITCH_SPEECH.includes("changed from plan to build"));
  assert.ok(BUILD_SWITCH_SPEECH.includes("no longer in read-only mode"));
  assert.ok(BUILD_SWITCH_SPEECH.includes("make file changes, run shell commands"));
  assert.ok(BUILD_SWITCH_SPEECH.includes("<system-reminder>"));
});

test("speeches contain no em or en dashes", () => {
  for (const [name, text] of [["PLAN_SPEECH", PLAN_SPEECH], ["BUILD_SWITCH_SPEECH", BUILD_SWITCH_SPEECH]] as const) {
    assert.equal(text.includes("\u2014"), false, `${name} has an em dash`);
    assert.equal(text.includes("\u2013"), false, `${name} has an en dash`);
  }
});

test("appendEphemeralSpeech injects onto the LAST user message", () => {
  const messages: SpeechMessage[] = [
    { role: "user", content: "first" },
    { role: "assistant", content: [{ type: "text", text: "reply" }] },
    { role: "user", content: "current turn" },
    { role: "toolResult", content: [{ type: "text", text: "out" }] },
  ];
  const injected = appendEphemeralSpeech(messages, "SPEECH");
  assert.equal(injected, true);
  const target = messages[2] as { content: Array<{ type: string; text: string }> };
  assert.equal(target.role, "user");
  assert.equal(target.content.length, 2);
  assert.deepEqual(target.content[0], { type: "text", text: "current turn" });
  assert.deepEqual(target.content[1], { type: "text", text: "SPEECH" });
  // Nothing else was touched.
  assert.equal(messages[0].content, "first");
  assert.equal(messages[3].role, "toolResult");
});

test("appendEphemeralSpeech appends to part-array content and synthesizes parts for string content", () => {
  const stringContent: SpeechMessage = { role: "user", content: "hello" };
  assert.equal(appendEphemeralSpeech([stringContent], "S"), true);
  const parts = stringContent.content as Array<{ type: string; text: string }>;
  assert.equal(parts.length, 2);
  assert.deepEqual(parts[0], { type: "text", text: "hello" });
  assert.deepEqual(parts[1], { type: "text", text: "S" });

  const arrayContent: SpeechMessage = {
    role: "user",
    content: [{ type: "text", text: "a" }, { type: "image", data: "x" }],
  };
  assert.equal(appendEphemeralSpeech([arrayContent], "S"), true);
  const arrayParts = arrayContent.content as Array<Record<string, unknown>>;
  assert.equal(arrayParts.length, 3);
  assert.deepEqual(arrayParts[2], { type: "text", text: "S" });
  // Original parts are preserved untouched.
  assert.deepEqual(arrayParts[0], { type: "text", text: "a" });
  assert.deepEqual(arrayParts[1], { type: "image", data: "x" });
});

test("appendEphemeralSpeech returns false and does nothing without a user message", () => {
  const messages: SpeechMessage[] = [
    { role: "assistant", content: [{ type: "text", text: "only a reply" }] },
    { role: "toolResult", content: [{ type: "text", text: "out" }] },
  ];
  assert.equal(appendEphemeralSpeech(messages, "S"), false);
  assert.equal(messages.length, 2);
  assert.equal((messages[0].content as Array<Record<string, unknown>>).length, 1);
  assert.equal(appendEphemeralSpeech([], "S"), false);
});

test("delivery is ephemeral: no custom entry or custom_message part is ever produced", () => {
  // Structural proof of the no-persistence contract: the injected shape is only
  // a text part on a plain user message (role user), never a custom message
  // (opencode pushes a synthetic text part the same way, in memory only).
  const messages: SpeechMessage[] = [{ role: "user", content: "turn" }];
  appendEphemeralSpeech(messages, PLAN_SPEECH);
  const target = messages[0] as { role: string; content: Array<Record<string, unknown>> };
  assert.equal(target.role, "user");
  for (const part of target.content) {
    assert.equal(part.type, "text");
    assert.equal(Object.keys(part).includes("customType"), false);
  }
  assert.equal(messages.some((m) => m.role === "custom"), false);
});
