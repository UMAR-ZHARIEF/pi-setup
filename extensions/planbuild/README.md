# planbuild

A pi extension that adds opencode-style plan and build modes with a strict plan-mode shell gate. The active mode is stored in the session, so it survives resume. Build mode is the default and enforces nothing.

## Commands and shortcut

- `/mode plan`, `/mode build`, `/mode toggle`: switch modes. `/mode` with no argument shows the current mode and usage.
- `alt+m`: toggle between plan and build. The staged pi 0.86.1 docs show no default alt+m binding, so alt+m was kept.
- `pi --plan` / `pi --build`: seed a new session in that mode (an explicit flag wins over a resumed mode entry for that launch).
- The footer status line always shows the active mode.

## What plan mode blocks

- **File tools**: `edit` and `write` may only touch paths inside `.pi/plans/` (forward slashes; relative and absolute paths are normalized before checking, and a leading `@` is stripped). Everything else is denied with the reason.
- **bash**: fail-closed read-only gate. The command is split on pipes, `&&`, `||`, `;` (and newlines) and EVERY segment must pass. A segment passes when its first token is one of `ls`, `cat`, `head`, `tail`, `wc`, `file`, `pwd`, `which`, `echo`, `rg`, `grep`, `find`, or `git` followed by exactly one read subcommand (`status`, `log`, `diff`, `show`, `branch`, `remote -v`, `rev-parse`, no extra arguments), or when the segment is exactly two tokens `<word> --version`. Matching is case-sensitive.
- **powershell**: same gate, but segments must start with a canonical full cmdlet name: `Get-Content`, `Get-ChildItem`, `Get-Item`, `Select-String`, `Get-Location`, `Measure-Object`, `Sort-Object`, `Where-Object`, `Format-List`, `Format-Table`, `Compare-Object`, `Get-Date`, plus the same `git` and `--version` rules. Aliases are denied. Cmdlet matching is case-insensitive (PowerShell semantics); bash stays case-sensitive.
- **Both shells deny**: any redirect (`>`, `>>`, `2>`, `<`), command substitution (`$(...)` or backticks), subshell parentheses, variables (`$` followed by a letter), script blocks (`{`, `}`, a lone `&`, or `Invoke-Expression`), and `git -C`. Quoting is not parsed, so anything unparsed, empty, or unknown is denied.
- **Subagents**: the pi-subagents dispatch tool is named `subagent` and carries the agent name in its `agent` parameter. In plan mode only `scout`, `researcher`, `reviewer`, `oracle`, `delegate` are allowed; `worker`, unknown names, and a missing name are denied with a reason that points at build mode.
- **Own tools**: `plan_question` is allowed in plan mode; `plan_exit` is allowed only in plan mode and is denied in build mode.
- **Everything else** goes through the rule engine (`evaluate`: last matching rule wins). The built-in rule set opens with a catch-all `ask` rule followed by specific overrides: the read-only builtins `read`, `grep`, `find`, and `ls` are allowed; unknown tools (including MCP tools) fall through to the catch-all and therefore prompt in interactive sessions; with no UI (one-shot/print runs) `ask` fails closed and blocks the call. A specific unknown tool can be allowed permanently through `customRules` (see the config file below). The hard gates (plan paths, shell allowlists, subagent names) remain non-overridable.

`plan_exit` asks the user to confirm the switch; on approval the extension switches to build mode and injects the adapted build-switch prompt plus the instruction to execute the approved plan. Entering plan mode injects the adapted read-only reminder each turn, mentioning the `.pi/plans/` convention and the research-only dispatch rule; injected reminders are filtered to a single live copy so they do not accumulate.

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

Semantics ported from opencode v1.19.5 (MIT, github.com/anomalyco/opencode) and Pi's plan-mode example (MIT).
