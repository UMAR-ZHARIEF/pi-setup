import test from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_QUESTION_TIMEOUT_SECONDS,
  NO_ANSWER_TEXT,
  PLAN_EXIT_NOT_APPROVED_TEXT,
  questionTimeoutSeconds,
  withDialogTimeout,
} from "../timeout.ts";

test("questionTimeoutSeconds defaults to 300", () => {
  assert.equal(DEFAULT_QUESTION_TIMEOUT_SECONDS, 300);
  assert.equal(questionTimeoutSeconds({}), 300);
  assert.equal(questionTimeoutSeconds({ questionTimeoutSeconds: undefined }), 300);
});

test("questionTimeoutSeconds accepts positive numbers and floors fractions", () => {
  assert.equal(questionTimeoutSeconds({ questionTimeoutSeconds: 30 }), 30);
  assert.equal(questionTimeoutSeconds({ questionTimeoutSeconds: 1 }), 1);
  assert.equal(questionTimeoutSeconds({ questionTimeoutSeconds: 2.9 }), 2);
});

test("questionTimeoutSeconds falls back to 300 on invalid values", () => {
  const invalid: unknown[] = [0, -5, NaN, Infinity, -Infinity, "45", null, true, { seconds: 5 }];
  for (const value of invalid) {
    assert.equal(questionTimeoutSeconds({ questionTimeoutSeconds: value as number }), 300, String(value));
  }
});

test("withDialogTimeout passes the timeout through and resolves a dialog answer", async () => {
  let seen: number | undefined;
  const outcome = await withDialogTimeout(async (opts) => {
    seen = opts.timeout;
    return "pizza";
  }, 30);
  assert.equal(seen, 30000);
  assert.deepEqual(outcome, { value: "pizza", timedOut: false });
});

test("withDialogTimeout reports timedOut with no value when the deadline fires first", async () => {
  const outcome = await withDialogTimeout(() => new Promise<string>(() => {}), 0.01);
  assert.deepEqual(outcome, { value: undefined, timedOut: true });
});

test("withDialogTimeout prefers the deadline over a late dialog resolution", async () => {
  const outcome = await withDialogTimeout(
    () => new Promise<string>((resolve) => setTimeout(() => resolve("late"), 50)),
    0.01,
  );
  assert.deepEqual(outcome, { value: undefined, timedOut: true });
});

test("withDialogTimeout propagates dialog rejections", async () => {
  await assert.rejects(
    withDialogTimeout(() => Promise.reject(new Error("boom")), 30),
    /boom/,
  );
});

// ---------------------------------------------------------------------------
// Not-a-verdict wording (plan part 4, user decision 2026-11-06): a dismissed or
// timed-out box is NOT a verdict on the substance. The old "User rejected"
// phrasing is gone.
// ---------------------------------------------------------------------------

test("NO_ANSWER_TEXT carries the approved plan_question wording", () => {
  assert.equal(
    NO_ANSWER_TEXT,
    "No answer given (dialog dismissed or timed out; this is not a no; ask in chat or proceed with a stated default).",
  );
  assert.match(NO_ANSWER_TEXT, /no answer given/i);
  assert.match(NO_ANSWER_TEXT, /dismissed or timed out/i);
  assert.match(NO_ANSWER_TEXT, /not a no/i);
  assert.match(NO_ANSWER_TEXT, /ask in chat or proceed with a stated default/i);
  assert.doesNotMatch(NO_ANSWER_TEXT, /rejected/i);
});

test("PLAN_EXIT_NOT_APPROVED_TEXT carries the approved plan_exit wording", () => {
  assert.equal(
    PLAN_EXIT_NOT_APPROVED_TEXT,
    "The approval dialog was dismissed without a decision (not a rejection of the plan); tell the user the approval is still pending and ask whether to switch, wait, or keep planning.",
  );
  assert.match(PLAN_EXIT_NOT_APPROVED_TEXT, /dismissed without a decision/i);
  assert.match(PLAN_EXIT_NOT_APPROVED_TEXT, /not a rejection of the plan/i);
  assert.match(PLAN_EXIT_NOT_APPROVED_TEXT, /approval is still pending/i);
  assert.match(PLAN_EXIT_NOT_APPROVED_TEXT, /switch, wait, or keep planning/i);
  // The old phrasing that guessed intent from a keystroke is removed.
  assert.doesNotMatch(PLAN_EXIT_NOT_APPROVED_TEXT, /user rejected/i);
  assert.doesNotMatch(PLAN_EXIT_NOT_APPROVED_TEXT, /keep refining the plan/i);
});
