# planbuild

A pi extension that adds opencode-style plan and build modes with a strict plan-mode shell gate. The mode for each message is derived from mode stamps persisted in the session tree, so it survives resume. Build mode is the default and enforces nothing.

## Mode lifecycle (per-message semantics)

Every turn's gate mode is derived from the stamps preceding that turn's user message on the live branch of the session tree: entries are walked backwards from the last user message (newest first) until a `planbuild-mode` custom entry with a valid `plan` or `build` value is found; malformed stamp values are skipped, and with no stamp before that message the configured `defaultMode` applies. Mode switches (`/mode`, `alt+m`, `plan_exit` approval, `--plan`/`--build` at startup) append a stamp when the target mode differs from the last stamp on the live branch; the stamp log is the source of truth.

- Switches apply to new messages only, never retroactively: a turn gates on the stamps that precede its own user message, so a flip stamped after that message cannot affect the turn that is already running. The `plan_exit` approval is the deliberate exception: it delivers the "execute the plan" instruction as a user message, which becomes the new derivation anchor on the branch, so the rest of that run is gated as build.
- The status line shows the derived next-turn mode (the mode the next message will run under), warning-colored in plan mode and muted in build mode.
- Plan reminders and build-switch messages stay in the transcript exactly as sent, forever. They are never deleted or rewritten when the mode changes.
- Editing an old message truncates the live branch before later stamps, so the replayed turn derives its original mode from the stamps that still precede it. Stamps on abandoned branches (dead entries outside the live branch) are never consulted.

### Queued messages (typed while a reply is streaming)

pi 0.86.1 delivers a message typed (or steered) while another turn is streaming as a continuation of the same run, and its turn-start hook never fires for those turns. planbuild still gates them correctly: a queued user message is appended to the session branch before its turn runs, and the gate derives from the stamps preceding that message, so a flip pressed before the queued message was delivered governs it (for example, a queued write attempt after `/mode plan` is blocked).

Two honest limitations remain, both pi-side:

- The plan-mode banner may not precede a queued turn: pi injects it only at the turn-start hook, which queued turns bypass. The gate never depends on the banner.
- Build-switch notices are written to the transcript at flip time (immediately when idle; at the next turn boundary while a turn is streaming, which is still before any queued continuation runs). They never pile up for a later prompt.

## Commands and shortcut

- `/mode plan`, `/mode build`, `/mode toggle`: switch modes. `/mode` with no argument shows the current mode and usage.
- `alt+m`: toggle between plan and build. The staged pi 0.86.1 docs show no default alt+m binding, so alt+m was kept.
- `pi --plan` / `pi --build`: start in that mode by appending a mode stamp, so the flag overrides the derived mode (including on a resumed session) and applies to the messages that follow.
- The footer status line always shows the active mode.

## What plan mode blocks

- **File tools**: `edit` and `write` may only touch paths inside `.pi/plans/` (forward slashes; relative and absolute paths are normalized before checking, and a leading `@` is stripped). Everything else is denied with the reason.
- **bash**: fail-closed read-only gate. The command is split on pipes, `&&`, `||`, `;` (and newlines) and EVERY segment must pass. A segment passes when its first token is one of `ls`, `cat`, `head`, `tail`, `wc`, `file`, `pwd`, `which`, `echo`, `rg`, `grep`, `find`, or `git` followed by exactly one read subcommand (`status`, `log`, `diff`, `show`, `branch`, `remote -v`, `rev-parse`, no extra arguments), or when the segment is exactly two tokens `<word> --version`. Matching is case-sensitive.
- **powershell**: same gate, but segments must start with a canonical full cmdlet name: `Get-Content`, `Get-ChildItem`, `Get-Item`, `Select-String`, `Get-Location`, `Measure-Object`, `Sort-Object`, `Where-Object`, `Format-List`, `Format-Table`, `Compare-Object`, `Get-Date`, plus the same `git` and `--version` rules. Aliases are denied. Cmdlet matching is case-insensitive (PowerShell semantics); bash stays case-sensitive.
- **Both shells deny**: any redirect (`>`, `>>`, `2>`, `<`), command substitution (`$(...)` or backticks), subshell parentheses, variables (`$` followed by a letter), script blocks (`{`, `}`, a lone `&`, or `Invoke-Expression`), and `git -C`. Quoting is not parsed, so anything unparsed, empty, or unknown is denied.
- **Subagents**: the pi-subagents dispatch tool is named `subagent` and carries the agent name in its `agent` parameter. In plan mode only `scout`, `researcher`, `reviewer`, `oracle`, `delegate` are allowed; `worker`, unknown names, and a missing name are denied with a reason that points at build mode.
- **Own tools**: `plan_question` is allowed in plan mode; `plan_exit` is allowed only in plan mode and is denied in build mode.
- **Everything else** goes through the rule engine (`evaluate`: last matching rule wins). The built-in rule set opens with a catch-all `ask` rule followed by specific overrides: the read-only builtins `read`, `grep`, `find`, and `ls` are allowed; unknown tools fall through to the catch-all and therefore prompt in interactive sessions; with no UI (one-shot/print runs) `ask` fails closed and blocks the call. A specific unknown tool can be allowed permanently through `customRules` (see the config file below). The hard gates (plan paths, shell allowlists, subagent names) remain non-overridable. This interactive ask path is reachable ONLY for non-MCP custom tools: MCP tool-server calls are classified before it and never reach it (see the MCP tool tiers below; the classifier never returns ask).

`plan_exit` asks the user to confirm the switch; on approval the extension switches to build mode and injects the adapted build-switch prompt plus the instruction to execute the approved plan. The confirm box auto-dismisses after the configured timeout (see "Question and approval timeouts" below); a timeout is treated as NOT approved and the session stays in plan mode. Entering plan mode injects the adapted read-only reminder each turn, mentioning the `.pi/plans/` convention and the research-only dispatch rule. Injected reminders and build-switch messages persist in the transcript exactly as sent (see the mode lifecycle section above).

### MCP tool tiers

MCP tool-server calls (the `mcp__<server>` namespace proxies) are classified by sub-command before the generic rules run. The principle (user decision 2026-11-05: ZERO permission popups in plan mode): a call is either a known read that passes silently or it is denied outright with a switch-to-build message. The ask tier is EMPTY by design: the classifier never returns ask, so an MCP call can never open a permission popup.

- **Allowed silently**: reads and the whole browser. Every tool on every playwright server passes, viewing and interactions alike, plus read-tier sub-commands such as serena `find_symbol`, github `get_file_contents`, supabase `list_tables`, and photoshop `get_document_info`.
- **Denied outright**: memory, code, repository, database, and document mutations, for example serena `write_memory` or `edit_memory`, github `push_files` or `create_pull_request`, supabase `execute_sql` or `create_project`, illustrator `save_document` or `export`, photoshop `save_psd` or `undo`.
- **Denied outright, unclassified (zero popups)**: the `mcp` gateway itself (the universal wrapper can reach any server and cannot be pre-classified; use direct server tools or build mode), any unknown server, any unknown sub-command on a known server, and a missing sub-command. Reason string: `not classified as a read in plan mode; switch to build mode with /mode build`.

The built-in allow and deny verdicts for MCP calls are a hard gate that `customRules` cannot override. Tier lists enumerate exact names from the live adapter inventory (`mcp-cache.json`), so an unlisted name can never silently classify as a read; unlisted names now DENY. User decision 2026-11-05: all browser tools, interactions included, are allowed in plan mode, so research browsing is never interrupted.

Caveat: if a future pi-mcp-adapter config enables flattened direct tool registration (`directTools`) instead of namespace proxies, calls would no longer arrive as `mcp__<server>`, the classification would not see them, and the tier lists would need revisiting.

## Config file

`C:\Users\Guess\.pi\agent\planbuild.json`, all keys optional (an absent file means defaults):

```json
{
  "defaultMode": "build",
  "extraSafeShellCommands": ["node", "Get-Process"],
  "customRules": [{ "tool": "webfetch", "pattern": "*", "action": "ask" }],
  "questionTimeoutSeconds": 300
}
```

- `defaultMode`: `"build"` (default) or `"plan"` for new sessions.
- `extraSafeShellCommands`: extra exact-name first tokens for bash and extra cmdlet names for powershell, added to both allowlists.
- `customRules`: engine rules merged last, so they win over the built-in rule set in the generic rule evaluation. The hard plan-mode gates (plan paths, shell allowlists, subagent names) are not overridable by config.
- `questionTimeoutSeconds`: dialog timeout in whole seconds for `plan_question` (both the select and the free-text input box) and the `plan_exit` approval confirm. Default 300; invalid values (missing, non-numeric, non-finite, zero, negative) fall back to the default; fractions are floored. Timeouts only dismiss the box; they never answer or approve anything.

### Question and approval timeouts

The two human-answer boxes no longer block a turn forever when nobody is at the keyboard. pi 0.86.1 supports this natively (`ExtensionUIDialogOptions.timeout`, in milliseconds, with a live countdown display), and planbuild passes the configured timeout to every box:

- `plan_question`: when the select or input box times out, the tool returns `User answer: (no answer: timed out after N seconds)` with details answer `(timeout)`. It never picks an option or invents text on the user's behalf.
- `plan_exit`: when the approval confirm times out, the timeout counts as NOT approved. The tool returns the rejection text with a `(no answer: timed out after N seconds, treated as NOT approved)` note and the session stays in plan mode.

Timeouts never approve anything: an absent user is treated like a refusal, in the boxes above and everywhere else.

## Attribution

The shell gate and mode UX are adapted from opencode (MIT, github.com/anomalyco/opencode) and Pi's plan-mode example (MIT). The mode lifecycle is not a port of opencode's session-global mode: it follows pi session-tree stamps with per-message derivation on the live branch, as described above.
