# planbuild

A pi extension that adds opencode-style plan and build modes with the full opencode plan posture. The mode for each message is derived from mode stamps persisted in the session tree, so it survives resume. Build mode is the default and enforces nothing.

## Mode lifecycle (per-message semantics)

Every turn's gate mode is derived from the stamps preceding that turn's user message on the live branch of the session tree: entries are walked backwards from the last user message (newest first) until a `planbuild-mode` custom entry with a valid `plan` or `build` value is found; malformed stamp values are skipped, and with no stamp before that message the configured `defaultMode` applies. Mode switches (`/mode`, `alt+m`, `plan_exit` approval, `--plan`/`--build` at startup) append a stamp when the target mode differs from the last stamp on the live branch; the stamp log is the source of truth.

- Switches apply to new messages only, never retroactively: a turn gates on the stamps that precede its own user message, so a flip stamped after that message cannot affect the turn that is already running. The `plan_exit` approval is the deliberate exception: it delivers the "execute the plan" instruction as a user message, which becomes the new derivation anchor on the branch, so the rest of that run is gated as build. A post-approval override covers the milliseconds BEFORE that steered message lands: once the approval confirm is accepted, the gate treats the remainder of the approval turn as build regardless of the anchor (the model's immediate dispatch cannot be denied with "switch to build mode" right after the user approved switching), and the override clears at the next turn start.
- The status line shows the derived next-turn mode (the mode the next message will run under), warning-colored in plan mode and muted in build mode.
- Reminder speeches are never persisted. The plan speech rides every model call ephemerally and the build-switch speech rides the first build turn after a plan turn (see the reminder delivery section below); the transcript contains none of them.
- Editing an old message truncates the live branch before later stamps, so the replayed turn derives its original mode from the stamps that still precede it. Stamps on abandoned branches (dead entries outside the live branch) are never consulted. This preservation of the original mode is a deliberate improvement over opencode, which stamps the replayed message with the currently selected mode (see the parity section).

### Queued messages (typed while a reply is streaming)

pi 0.86.1 delivers a message typed (or steered) while another turn is streaming as a continuation of the same run, and its turn-start hook never fires for those turns. planbuild still gates them correctly: a queued user message is appended to the session branch before its turn runs, and the gate derives from the stamps preceding that message, so a flip pressed before the queued message was delivered governs it (for example, a queued write attempt after `/mode plan` is blocked).

The reminder speeches cover queued turns too: pi fires the `context` event before EVERY model call, including the steered and follow-up continuations of a run (the agent loop drains those queues inside the same run and routes each call through the event), so a queued plan turn sees the plan speech exactly like a direct one.

## Commands and shortcut

- `/mode plan`, `/mode build`, `/mode toggle`: switch modes. `/mode` with no argument shows the current mode and usage.
- `alt+m`: toggle between plan and build. The staged pi 0.86.1 docs show no default alt+m binding, so alt+m was kept.
- `pi --plan` / `pi --build`: start in that mode by appending a mode stamp, so the flag overrides the derived mode (including on a resumed session) and applies to the messages that follow.
- The footer status line always shows the active mode.

## What plan mode enforces (full opencode posture)

Plan mode enforces exactly opencode's plan agent rules and nothing more (user decision 2026-11-07). The ONLY two gates:

- **File tools**: `edit` and `write` may only touch paths inside `.pi/plans/` (forward slashes; relative and absolute paths are normalized before checking, and a leading `@` is stripped; matching is case-insensitive). Everything else is denied with a reason that names the convention and points at `/mode build`.
- **Subagents**: the pi-subagents dispatch tool is named `subagent` and carries the agent name in its `agent` parameter. In plan mode only the research agents `scout`, `researcher`, `reviewer`, `oracle`, `delegate` are allowed; `worker` (the implementation worker, opencode's `task.general` equivalent), unknown names, and a missing name are denied with a reason that points at build mode.

Everything else is ALLOWED silently in plan mode: `bash` and `powershell` unrestricted (no shell gate anymore; the strict plan speech is the fence, exactly like opencode where the plan agent's permission layer also allows bash and relies on the plan prompt), every `mcp__<server>` tool call including known mutators (serena memory edits, github pushes, supabase SQL), the `mcp` gateway, unknown extension tools, the web tools, background and fusion tools, `mcpScript`, todo tools. There is no ask tier anywhere: the gate returns only silent allows or hard blocks, so plan mode can never open a permission popup (and silent allows need no popup anyway). The always-on workflow-guards extension (recycle gatekeeper, memory-write block, .env ask) remains the machine's real guard layer and is untouched by planbuild.

The former strict gates were removed with this posture change: the read-only bash/powershell allowlists (shellgate), the MCP read/deny tier classifier (classify), the unknown-tool deny, the non-MPC catch-all deny, and the generic rule engine (engine). The retired config doors (`extraSafeShellCommands`, `planAllowServers`, `planAllowTools`) are no longer read; stale entries in an existing planbuild.json are harmless.

`plan_exit` asks the user to confirm the switch; on approval the extension stamps build mode, injects the "The plan has been approved. Execute the plan now." user message (the new derivation anchor), and gates the REST of that turn as build via the post-approval override (see the mode lifecycle section above). A dismissal or timeout is NOT a verdict on the plan: the tool returns the not-a-rejection wording and the session stays in plan mode.

## Reminder delivery (ephemeral, per model call)

Port of opencode's `session/reminders.ts` delivery model (v1.19.5). The fence for plan mode is the speech, delivered fresh on every model call:

- **Plan speech, every plan-mode call**: pi fires the `context` event "Fired before each LLM call" with a deep copy of the messages (pi extensions.md, context event: "Modify messages non-destructively... event.messages - deep copy, safe to modify"). planbuild appends the speech as an extra text part on the current turn's user message of that copy and returns the modified list. The copy exists only for THIS call, so nothing is persisted: no custom entries, no custom_message parts, nothing appended to the session file. Queued turns are covered because the event fires on their calls too (see the queued messages section above).
- **Build-switch speech, one-shot**: when a turn runs in build mode and the immediately preceding turn ran in plan mode, the same ephemeral injection delivers opencode's build-switch wording on the model calls of that first build turn. "Previous turn ran plan" is derived statelessly from the stamps preceding the previous user-message anchor (modelifecycle.ts `derivePreviousTurnMode`), so consecutive build turns inject nothing, the `plan_exit` approval continuation is exactly the first build turn, and queued cascades fire the speech on the flipped queued turn.
- **Wording**: the plan speech adapts opencode's `session/prompt/plan.txt` (read-only phase, strictly forbidden to modify files or run non-readonly commands, overrides ALL other instructions including direct user edit requests, zero exceptions) plus the `.pi/plans/` convention sentence and the `plan_question`/`plan_exit` guidance. The build-switch speech adapts opencode's `session/prompt/build-switch.txt`.
- The old persisted injections are gone: the turn-start banner (which never preceded queued turns) and the persisted flip-time build notice were removed in favor of the ephemeral delivery.
- Compaction and cache-warming requests do not route through the context event, so they never receive a speech; they summarize or warm the plain conversation.

## Config file

`C:\Users\Guess\.pi\agent\planbuild.json`, all keys optional (an absent file means defaults):

```json
{
  "defaultMode": "build",
  "questionTimeoutSeconds": 300
}
```

- `defaultMode`: `"build"` (default) or `"plan"` for new sessions.
- `questionTimeoutSeconds`: dialog timeout in whole seconds for `plan_question` (both the select and the free-text input box) and the `plan_exit` approval confirm. Default 300; invalid values (missing, non-numeric, non-finite, zero, negative) fall back to the default; fractions are floored. Timeouts only dismiss the box; they never answer or approve anything.
- Retired keys (`extraSafeShellCommands`, `planAllowServers`, `planAllowTools`) are ignored harmlessly; the full posture left nothing for them to admit.

### Question and approval timeouts

The two human-answer boxes no longer block a turn forever when nobody is at the keyboard. pi 0.86.1 supports this natively (`ExtensionUIDialogOptions.timeout`, in milliseconds, with a live countdown display), and planbuild passes the configured timeout to every box. A dismissed (Esc) or timed-out box is NOT a verdict on the substance (user decision 2026-11-06):

- `plan_question`: when the select or input box is dismissed or times out, the tool returns `No answer given (dialog dismissed or timed out; this is not a no; ask in chat or proceed with a stated default).` with details answer `(no answer)` and the `timedOut` flag. It never picks an option or invents text on the user's behalf.
- `plan_exit`: when the approval confirm is dismissed or times out, the tool returns `The approval dialog was dismissed without a decision (not a rejection of the plan); tell the user the approval is still pending and ask whether to switch, wait, or keep planning.` and the session stays in plan mode.

Timeouts and dismissals never approve anything: an absent user means "no decision", never a yes and never a no.

## Parity with opencode v1.19.5

Authoritative source: `scratch\opencode-protocol-definitive.md` (full source read of opencode v1.19.5). The sixteen protocol points, and where planbuild stands after the full-posture batch:

| # | Point | opencode v1.19.5 | planbuild | Verdict |
|---|-------|------------------|-----------|---------|
| 1 | Modes are agents | plan and build are builtin primary agents; the mode IS the agent name | one session, two modes switched by persisted stamps | Match (mechanism differs: stamps instead of agent fields; semantics identical) |
| 2 | Stamping | every user message carries the selected agent; assistant messages carry mode and agent | mode stamps are persisted custom entries on the branch; derivation reads stamps | Match |
| 3 | Active mode resolution | the loop re-resolves the newest user message's agent on every iteration | per-anchor derivation re-resolves whenever the anchor user message changes (tool_call and context time) | Match |
| 4 | Switching UX | Tab cycling, agent list, completed plan_exit flips the selector | `/mode`, `alt+m`, plan_exit approval stamps build | Match (no TUI selector in pi; the switches cover the same flows) |
| 5 | Permission layer | defaults allow everything; the plan agent adds edit deny outside plan files and task.general deny | the same two denies (edit/write outside `.pi/plans/`, worker dispatch) and everything else silent | Posture flip (this batch): the former strict deny tiers were flipped to allow-all parity |
| 6 | Call-time enforcement | every tool asks its permission with patterns at call time | the tool_call gate evaluates the two denies per call with path normalization | Match |
| 7 | Tool visibility | request-time filter hides a tool only under a catch-all deny; inert in plan mode, nothing hidden | nothing is hidden; all tools stay registered and allowed in plan mode | Match |
| 8 | The speech | strict plan.txt pushed onto the current user message per loop iteration, in memory, never persisted; build-switch the same on returning to build | the same ephemeral delivery via pi's context event, every call, queued turns included; build-switch one-shot | Speech gap fixed (this batch): the old persisted banner and flip notice were replaced by the ephemeral port |
| 9 | plan_exit | a real tool, registered only under the experimental flag plus cli client; absent by default | always registered; UI confirm with not-a-verdict timeouts; headless no-UI fails closed | Match with documented divergence: planbuild registers it unconditionally (user-ordered; upstream gates it behind a flag) |
| 10 | Revert (edit old message) | cleanup deletes later messages; the replay is stamped with the CURRENTLY selected mode | stamps surviving on the branch preserve the replayed turn's ORIGINAL mode | Kept deliberate improvement (user-ordered): original-mode preservation, a divergence in the user's favor |
| 11 | Queued messages | no client queue; the loop's newest-user-message rule makes the newest queued message run next under its own stamp | pi queues exist; per-anchor gating gives each queued turn the stamps preceding its own message | Match |
| 12 | Compaction | runs under a hidden all-denied agent; user mode survives via the original user message on replay | compaction and cache warming bypass the context event; the stamps on the branch survive compaction | Match |
| 13 | Headless | non-interactive sessions deny question and plan_exit outright and auto-reject asks unless --auto | `ctx.hasUI` guards return no-UI results; plan_question and plan_exit fail closed without a UI; the gates still hold | Match |
| 14 | V2 mirror | a half-built parallel v2 (mode field dropped, plan_exit unported, reminders marked missing); v1 is the live protocol | pi has a single session system; nothing to mirror | Not applicable |
| 15 | Subagents | task gates on the subagent name; child sessions inherit deny rules; nesting depth one | worker dispatch denied, research agents allowed; the gate sits at dispatch in the parent | Match (worker is the task.general equivalent) |
| 16 | Plan files | `.opencode/plans/<timestamp>-<slug>.md` allowlisted in the plan agent's edit rules | `.pi/plans/` path-segment allowlist; the model names the file | Match with documented path divergence |

Tally: 14 of 16 points at parity (points 5 and 8 reached parity through this batch's posture flip and speech fix), point 10 kept as a deliberate improvement, point 14 not applicable.

### Discovered facts that prevent future mistakes

- opencode allows unknown tools by default: the defaults ruleset is allow-everything, and the evaluator's fallback ask is unreachable for tools. Plan-mode strictness upstream comes ONLY from the plan agent's edit deny and the speech.
- `plan_enter` never existed in v1.19.5 anywhere in the source.
- `plan_exit` is flag-gated upstream (experimental plan-mode flag plus cli client) and absent by default on a stock install.
- The request-time tool-hiding machinery exists but is inert in plan mode: the plan agent's edit rules end in path-patterned allows, not a catch-all deny, so no tool is ever hidden.
- Headless opencode (`opencode run`) auto-rejects every permission ask unless `--auto` is passed, and denies question, plan_enter, and plan_exit outright.
- The v2 session system is half-built (messages drop the mode field, plan_exit is an upstream TODO, the v2 spec marks the plan reminders missing); the v1 path is the live protocol.
- A user wildcard allow overrides even the plan agent's edit deny upstream (user config merges last for builtin agents); planbuild has no user override layer, so its two denies are unconditional.

## Attribution

Mode UX, plan posture, and the reminder speeches are adapted from opencode v1.19.5 (MIT, github.com/anomalyco/opencode). The mode lifecycle is not a port of opencode's session-global mode: it follows pi session-tree stamps with per-message derivation on the live branch, as described above. The former read-only shell gate (removed with the full posture) was originally adapted from opencode and Pi's plan-mode example (MIT).
