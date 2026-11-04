import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_QUESTION_TIMEOUT_SECONDS, questionTimeoutSeconds, withDialogTimeout } from "../timeout.ts";

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
