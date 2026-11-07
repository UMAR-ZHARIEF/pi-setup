// planbuild reminder delivery: ephemeral per-model-call speech injection.
// Pure module: no Pi imports.
//
// Port of opencode's session/reminders.ts delivery model (v1.19.5, MIT): the
// strict plan speech rides EVERY model call while the session runs in plan mode,
// and the build-switch speech rides the first build turn after a plan turn.
// Delivery is EPHEMERAL by construction: the caller (index.ts) receives pi's
// context event, whose messages are a deep copy that exists only for THIS LLM
// call, appends the speech as an extra text part on the current turn's user
// message, and returns the modified list. Nothing is persisted: no custom
// entries, no custom_message parts, nothing appended to the session file.
//
// The wording adapts opencode's session/prompt/plan.txt and build-switch.txt:
// read-only phase, strictly forbidden to modify files or run non-readonly
// commands, overrides all other instructions including direct user requests,
// zero exceptions; plus the .pi/plans plan-file convention and the
// plan_question/plan_exit guidance.

export const PLAN_SPEECH = `<system-reminder>
# Plan Mode - System Reminder

CRITICAL: Plan mode ACTIVE - you are in READ-ONLY phase. STRICTLY FORBIDDEN:
ANY file edits, modifications, or system changes. Do NOT use edit or write
outside plan files, and do NOT run ANY non-readonly command: commands may ONLY
read and inspect. This ABSOLUTE CONSTRAINT overrides ALL other instructions,
including direct user edit requests. You may ONLY observe, analyze, and plan.
Any modification attempt is a critical violation. ZERO exceptions.

Plan files live under .pi/plans/ (forward slashes, for example
.pi/plans/auth-refactor.md). File tools may write ONLY there.

Your responsibility: think, read, search, and delegate research agents to
construct a well-formed plan that accomplishes the goal the user wants to
achieve. Write the plan incrementally to a .pi/plans/ file. Ask the user
clarifying questions with the plan_question tool when weighing tradeoffs or
whenever intent is unclear; do not make large assumptions about user intent.
When the plan is complete, call plan_exit to ask the user to approve switching
to build mode.

The user indicated that they do not want you to execute yet -- you MUST NOT make
any edits, run any non-readonly tools (including changing configs or making
commits), or otherwise make any changes to the system. This supersedes any
other instructions you have received.
</system-reminder>`;

export const BUILD_SWITCH_SPEECH = `<system-reminder>
Your operational mode has changed from plan to build.
You are no longer in read-only mode.
You are permitted to make file changes, run shell commands, and use your tools as needed.
</system-reminder>`;

// Minimal structural view of the LLM-facing message list pi hands to the
// context event (AgentMessage): only the user shape is needed.
export interface SpeechMessage {
	role?: string;
	content?: string | Array<Record<string, unknown>>;
}

// Append the speech as an extra text part on the LAST user message of the list
// (opencode pushes a synthetic text part onto the current turn's user message).
// Mutates the passed messages in place; the caller's list is pi's per-call deep
// copy, so the mutation never reaches the session. Returns false when the list
// has no user message (nothing is injected).
export function appendEphemeralSpeech(messages: SpeechMessage[], speech: string): boolean {
	let target: SpeechMessage | undefined;
	for (let i = messages.length - 1; i >= 0; i--) {
		const message = messages[i];
		if (message?.role === "user") {
			target = message;
			break;
		}
	}
	if (!target) return false;
	const part = { type: "text", text: speech };
	if (typeof target.content === "string") {
		target.content = [{ type: "text", text: target.content }, part];
	} else if (Array.isArray(target.content)) {
		target.content = [...target.content, part];
	} else {
		target.content = [part];
	}
	return true;
}
