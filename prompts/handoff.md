---
description: Write a HANDOFF.md so a fresh session can continue this work
---

STOP all other work. Your remaining context is precious — spend it on this handoff and nothing else. A fresh opencode session is taking over and has ZERO knowledge of our conversation. The only bridge is the file you're about to write.

## CRITICAL FRAMING

The compaction summary preserves code state but LOSES reasoning, failed attempts, and the "why" behind decisions. Code survives. Thinking doesn't. Overweight the thinking.

Treat this like spawning a teammate in agent-teams: they load AGENTS.md, MCP servers, skills, and project files automatically — but inherit ZERO of your conversation. Encode every constraint, every "oh by the way" from the user, every dead end, every file touched and why, into this single document.

## YOUR JOB

Write to: `./HANDOFF.md` (in the current working directory).

If the user passed arguments via `$ARGUMENTS`, use them as the handoff title hint. If empty or vague, derive a title from the conversation.

When done, run the SELF-CHECK below, then reply with ONLY: `Handoff written. <N> words. Ready.` — nothing else. Save the rest of your context.

## SELF-CHECK (mandatory before replying "Ready.")

1. Re-read the file you just wrote.
2. Verify EVERY required section header from the structure below is present.
3. Verify no section is empty and none contains placeholder text (`TODO`, `<...>`, `FILL ME`, `[insert`, a lone `...`). A section with nothing real to say must say so explicitly (e.g. "None this session.") — never a placeholder.
4. Verify no secret VALUES appear anywhere in the file (scan for key-like strings; see RULES).
5. Fix anything that fails, re-check, and only then reply.

## RULES

- Assume the next session has read zero messages of this conversation.
- Specifics > prose. File paths, line numbers, function names, exact commands, exact error text. Never paraphrase errors — it kills searchability.
- Capture WHY, not just WHAT. A decision without rationale is a trap.
- Failures are as valuable as successes — they prevent expensive re-discovery.
- Mark `UNCERTAIN:` rather than guess. Hallucinated state is worse than missing.
- **NEVER paste secret VALUES** (API keys, tokens, passwords, connection strings, JWTs). Name the variable and the file that holds it instead (e.g. `SUPABASE_SECRET_KEY — lives in server/.env, gitignored`). A handoff that leaks a secret forces a key rotation.
- Use `@file` references for large content (e.g. `see @src/auth.ts:42-78`) instead of inlining. The next session can read on demand.
- Read-only state checks (`git status`, `ls`, `cat` of small files) ARE allowed and encouraged for §5. NO new edits, builds, tests, or experiments.
- Aim for ≤2000 words. Overflow only if reasoning depth requires it.

## REQUIRED STRUCTURE — use these exact headers

```
---
created: <ISO timestamp>
branch: <git branch, or "no git" if not a repo>
commit: <git rev-parse HEAD, or "no git">
trigger: context-exhaustion-handoff
---

# HANDOFF: <one-line title of the work>

## 1. The Goal
2-3 sentences. The single thing the next session must understand. Skip framing; lead with the destination.

## 2. The Very Next Step (start here)
Front-loaded on purpose: if this doc gets truncated, THIS must survive.
- The exact next action (a command, a file:line, a function to write).
- If it depends on a user decision, name the decision and rank candidates.

## 3. Scope Boundaries — Authorized / Forbidden
What the user has explicitly authorized vs explicitly refused or restricted. Approval domains are SEPARATE (code vs docs vs config vs memories) — permission in one is NOT permission in another.
- **Authorized:** <what may be done without re-asking>
- **Forbidden / not yet approved:** <explicit refusals, standing orders like "do not execute yet", "rearrange only — never delete", "ask before X">
If the next session is unsure whether an action is in scope: ask the user. Never infer scope from convenience.

## 4. Current Status — One Paragraph
What's done, what's broken, what's the blocker. One paragraph, no bullets.

## 5. Mechanical State (paste verbatim from tools)
- `git status --short`: (call out UNCOMMITTED/UNTRACKED work explicitly — it is the most-lost category of state)
- `git log --oneline -5`:
- Last test/build command + exit code + tail of output (if relevant)
- Background processes/servers running, and how to start/stop them
- Working directory, OS, shell, key env var NAMES (values NEVER — see RULES)

## 6. Read These First — boot manifest for the next session
Prospective, prioritized reading list — the fastest path to working context (NOT the same as §7, which is retrospective). ≤5 entries.
1. `@path` — why it's first
2. `@path` — why
Mark optional deep-dives as "on demand".

## 7. Files Touched (absolute paths)
- **Created:** path — one-line role
- **Modified:** path — WHAT changed and WHY (not just the filename)
- **Read for context only:** path — what you learned from it

## 8. What's Been Tried — Successes
Bullet list. Format: approach → outcome → why it worked.

## 9. What's Been Tried — Failures (CRITICAL — highest-leverage section)
Bullet list. Format: approach → exact failure (paste error in code fence) → root cause if known → why this seemed reasonable. Do not skip even if it feels embarrassing. Without this, the next session WILL repeat these.

## 10. Key Decisions & Rationale
Markdown table: Decision | Why | Alternatives rejected (and why). Only non-obvious decisions. Skip what a code reader can infer.

## 11. User Feedback & Preferences (this session)
Corrections, preferences, and tone/style feedback the user gave — quoted verbatim where short. These are STANDING INSTRUCTIONS for the next session, not suggestions. (Examples of the kind of thing that belongs here: "answer my question first, then continue", "in plain English", "only rearrange, never delete".) If none: "None this session."

## 12. Gotchas, Constraints, Surprises
Hidden constraints the next session won't discover by reading code: environmental quirks, version-specific behavior, MCP server idiosyncrasies, "obvious approach is wrong" cases, things the user mentioned in chat that aren't in any file.

## 13. Assumptions I've Been Operating Under
Things taken on faith without confirming. The next session should verify before building on them.

## 14. Open Questions / Pending User Decisions
For each: the question, why it's blocking, your recommended default if no answer arrives.

## 15. Verification Criteria
Exact commands to confirm the next step succeeded. "Should work" is NOT valid evidence — the next session must RUN the command and SEE the expected output before claiming success.
- Command: `<command>`
- Expected output / success signal
- Failure mode and remediation

## 16. Verbatim Reference (only if needed)
Error messages, log excerpts, config snippets that must be quoted exactly and don't fit elsewhere. Code fences. Don't duplicate §9 or §5.

---
> Source of truth: this document. If it contradicts the user, ask before assuming the user is wrong. If code contradicts a decision in §10, raise it before proceeding.
```

User-supplied title hint (if any): $ARGUMENTS
