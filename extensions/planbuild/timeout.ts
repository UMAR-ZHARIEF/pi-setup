// planbuild dialog timeout helper: pure module, no Pi imports.
//
// The two human-answer boxes (plan_question select/input and the plan_exit
// approval confirm) must never block a turn forever when nobody is at the
// keyboard. pi 0.86.1 natively supports this: ExtensionUIDialogOptions has
// `timeout?: number` in milliseconds ("Dialog auto-dismisses with live
// countdown display"), honored by the interactive components (ExtensionSelector
// CountdownTimer, ExtensionInput) and by the RPC createDialogPromise (which
// resolves the dialog's default value: select/input -> undefined, confirm ->
// false). This module adds the config key and a race wrapper that can tell a
// timeout apart from a manual dismissal, because the native promise resolves
// the same value for both.
//
// TIMEOUTS AND DISMISSALS ARE NEVER VERDICTS (user decision 2026-11-06): a
// timed-out or Esc-dismissed box means "no decision", never an answer and never
// a rejection of the substance. The shared wording constants below carry that
// semantics into both tool results: NO_ANSWER_TEXT for plan_question (select and
// input) and PLAN_EXIT_NOT_APPROVED_TEXT for the plan_exit approval confirm
// (the session stays in plan mode either way). The old "User rejected" phrasing
// is removed: it guessed the user's intent from a keystroke.

export const DEFAULT_QUESTION_TIMEOUT_SECONDS = 300;

// plan_question result for a dismissed OR timed-out box (exact approved wording,
// plan part 4): no answer was given, this is not a no, and the model must say in
// chat what was asked and either proceed with a stated default or ask again in
// plain chat.
export const NO_ANSWER_TEXT =
	"No answer given (dialog dismissed or timed out; this is not a no; ask in chat or proceed with a stated default).";

// plan_exit result when the approval box is dismissed or times out (exact approved
// wording, plan part 4). The old "User rejected the switch" text is removed: a
// dismissal is not a verdict on the plan.
export const PLAN_EXIT_NOT_APPROVED_TEXT =
	"The approval dialog was dismissed without a decision (not a rejection of the plan); tell the user the approval is still pending and ask whether to switch, wait, or keep planning.";

export interface TimeoutConfig {
	questionTimeoutSeconds?: number;
}

// Resolve the configured dialog timeout in whole seconds. Any invalid value
// (missing, non-number, non-finite, zero, negative) falls back to the default;
// valid fractional values are floored to whole seconds.
export function questionTimeoutSeconds(config: TimeoutConfig): number {
	const value = config.questionTimeoutSeconds;
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		return DEFAULT_QUESTION_TIMEOUT_SECONDS;
	}
	return Math.floor(value);
}

export interface DialogOutcome<T> {
	// The dialog's resolution, or undefined when the deadline fired first.
	value: T | undefined;
	// True only when the deadline timer resolved this outcome. timedOut never
	// carries an answer: callers must treat it as "no answer", never as consent.
	timedOut: boolean;
}

// Open a pi dialog with a native auto-dismiss timeout and race the deadline
// against it. openDialog receives the opts to pass to ctx.ui.select/input/
// confirm. The deadline timer is registered BEFORE openDialog runs, so on an
// unanswered dialog our timer precedes the dialog's equal-duration native timer
// in the event loop's same-expiry order and timedOut cannot be stolen by the
// dialog's own timeout resolution. When the user answers (or dismisses) before
// the deadline, the dialog resolution wins and timedOut is false; dialog
// rejections propagate unchanged.
export function withDialogTimeout<T>(
	openDialog: (opts: { timeout: number }) => Promise<T>,
	timeoutSeconds: number,
): Promise<DialogOutcome<T>> {
	const timeoutMs = Math.max(0, Math.round(timeoutSeconds * 1000));
	if (timeoutMs === 0) {
		// Defensive: questionTimeoutSeconds never produces <= 0 (invalid values
		// fall back to the default), so this branch only guards direct misuse.
		return openDialog({ timeout: 0 }).then((value) => ({ value, timedOut: false }));
	}
	return new Promise<DialogOutcome<T>>((resolve, reject) => {
		let settled = false;
		const timer = setTimeout(() => {
			if (settled) return;
			settled = true;
			// The deadline resolves with NO value: it never answers or approves.
			resolve({ value: undefined, timedOut: true });
		}, timeoutMs);
		openDialog({ timeout: timeoutMs }).then(
			(value) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				resolve({ value, timedOut: false });
			},
			(error) => {
				if (settled) return;
				settled = true;
				clearTimeout(timer);
				reject(error);
			},
		);
	});
}
