# planbuild

A pi extension that adds opencode-style plan and build modes with a strict plan-mode shell gate. The mode for each message is derived from mode stamps persisted in the session tree, so it survives resume. Build mode is the default and enforces nothing.

## Mode lifecycle (per-message semantics)

Every turn derives its mode from the nearest preceding mode stamp on the live branch of the session tree: entries are walked backwards (newest first) until a `planbuild-mode` custom entry with a valid `plan` or `build` value is found; malformed stamp values are skipped, and with no stamp at all the configured `defaultMode` applies. Mode switches (`/mode`, `alt+m`, `plan_exit` approval, `--plan`/`--build` at startup) append a stamp when the target mode differs from the last stamp on the live branch; the stamp log is the source of truth.

- Switches apply to new messages only, never retroactively. A turn that is already running keeps the mode it was started with. The only exception is the `plan_exit` approval: it invalidates the frozen mode of the running turn so the delivered "execute the plan" instruction is gated as build within that same turn.
- The status line shows the derived next-turn mode (the mode the next message will run under), warning-colored in plan mode and muted in build mode.
- Plan reminders and build-switch messages stay in the transcript exactly as sent, forever. They are never deleted or rewritten when the mode changes.
- Editing an old message truncates the live branch before later stamps, so the replayed turn derives its original mode from the stamps that still precede it. Stamps on abandoned branches (dead entries outside the live branch) are never consulted.

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
- **Everything else** goes through the rule engine (`evaluate`: last matching rule wins). The built-in rule set opens with a catch-all `ask` rule followed by specific overrides: the read-only builtins `read`, `grep`, `find`, and `ls` are allowed; unknown tools (including MCP tools) fall through to the catch-all and therefore prompt in interactive sessions; with no UI (one-shot/print runs) `ask` fails closed and blocks the call. A specific unknown tool can be allowed permanently through `customRules` (see the config file below). The hard gates (plan paths, shell allowlists, subagent names) remain non-overridable.

`plan_exit` asks the user to confirm the switch; on approval the extension switches to build mode and injects the adapted build-switch prompt plus the instruction to execute the approved plan. Entering plan mode injects the adapted read-only reminder each turn, mentioning the `.pi/plans/` convention and the research-only dispatch rule. Injected reminders and build-switch messages persist in the transcript exactly as sent (see the mode lifecycle section above).

## Config file

`C:\Users\Guess\.pi\agent\planbuild.json`, all keys optional (an absent file means defaults):

```json
{
  "defaultMode": "build",
  "extraSafeShellCommands": ["node", "Get-Process"],
  "customRules": [{ "tool": "webfetch", "pattern": "*", "action": "ask" }]
}
```

- `defaultMode`: `"build"` (default) or `"plan"` for new sessions.
- `extraSafeShellCommands`: extra exact-name first tokens for bash and extra cmdlet names for powershell, added to both allowlists.
- `customRules`: engine rules merged last, so they win over the built-in rule set in the generic rule evaluation. The hard plan-mode gates (plan paths, shell allowlists, subagent names) are not overridable by config.

## Attribution

The shell gate and mode UX are adapted from opencode (MIT, github.com/anomalyco/opencode) and Pi's plan-mode example (MIT). The mode lifecycle is not a port of opencode's session-global mode: it follows pi session-tree stamps with per-message derivation on the live branch, as described above.
