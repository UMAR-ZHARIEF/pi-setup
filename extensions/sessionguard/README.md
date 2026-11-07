# sessionguard

Closes the session-file flush race at session entry. If pi ever resumes a
session and some of the newest conversation is missing, sessionguard detects it
at startup, re-reads the session file, pulls the missing entries back into the
session state, and keeps the model's context on the recovered state. You see
one line when it recovers something, and silence when all is well.

## The defect, in plain English

pi writes your conversation to a session file (a `.jsonl` text file, one JSON
line per entry) as you talk. But it does not write every entry to disk right
away. Entries are buffered in memory and flushed to the file late, including at
the moment the process dies. In the installed code this is the `flushed` flag in
`session-manager.js` (`_persist`, dist/core/session-manager.js:741-777).

When a new pi process loads a session file, it rebuilds its index and picks the
resume point: `_buildIndex` walks every physical entry in the file and leaves
the resume leaf set to the LAST PHYSICAL ENTRY it finds
(dist/core/session-manager.js:687-703). Whatever is the last line on disk at
that instant becomes "where the conversation continues".

Put the two together and you get a race:

1. You restart pi while the old process is still alive (or dying).
2. The new process reads the file at an instant when the old process's newest
   entries are still only in memory. The resume leaf lands on an old entry.
3. Seconds later the old process flushes its tail to the file. Those entries
   are now on disk, but the new process has already resumed from the older
   leaf, so the tail becomes an invisible dead branch. The conversation
   continues from a point in the past.

## Tonight's incident (2026-11-07)

The main chat session had a branch point at line 1204 of its session file (a
board-read tool result from 11:07 UTC). The conversation kept going and the file
grew to line 1304 by 11:51:40 UTC. The user restarted pi at that moment. The new
process loaded while the old process's last 40 minutes were still unflushed, so
it resumed at the 11:07 UTC entry. The old process's tail flushed seconds later:
forty minutes of conversation became an invisible dead branch. Nothing was
deleted; the branch survives in the session file, but the resumed conversation
could not see it.

## The fix

On every `session_start` (startup, reload, new, resume, fork), sessionguard
re-reads the same session file once, through the session manager's own
`setSessionFile` with the current path. That call reruns the load and index
rebuild (`_setSessionFile` -> `_loadEntries` -> `_buildIndex`,
dist/core/session-manager.js:617-638, 672-685), so the resume leaf lands on the
true last entry even if the old process's tail flushed after the initial load.

Safety rails:

- It only re-reads when the session manager has no unflushed in-memory entries
  (the `flushed` flag is true), so the reload can never drop entries that exist
  only in memory. It can only gain.
- It skips sessions with no file (ephemeral) and brand-new sessions whose file
  holds only the header entry.
- It never runs mid-turn, only at session entry.
- The whole check is wrapped so any error is logged to the console only and can
  never break session startup.

When the reload gains entries, you see exactly one info line:

```
sessionguard: recovered N newer entries the initial load missed; resumed from the complete state.
```

N is the number of entries the first load missed. When nothing changed you see
nothing.

## The first-turn context fix

Recovering the session manager used to leave one hole: the agent runtime
snapshots its message list once at load and rebuilds that list only at
compaction and branch navigation, so the FIRST turn after a racy restart still
answered from the stale snapshot. That hole is now closed.

sessionguard registers a handler on pi's `context` event, which fires before
every LLM call, the first turn after recovery included. While the swap is
armed (an entry check gained entries), the handler returns the corrected
session manager's `buildSessionContext().messages`, and that return value
replaces the list the model receives for the call. It is a wholesale
replacement, never a partial merge, and it is safe because the fresh build
already contains every persisted message: the agent loop persists each new
prompt (and any queued messages) before the turn's first LLM request, so the
replacement can never drop the message that triggered the call.

The handler stays armed for the whole session on purpose: the runtime cache
never rebuilds on its own, the corrected session manager always returns the
live truth, and the per-call rebuild is cheap. When the runtime does rebuild
(compaction, branch navigation, a later session entry), the replacement
becomes a harmless no-op: the rebuilt runtime list and the fresh build contain
the same messages, so swapping changes nothing. When the swap is disarmed (no
recovery ever happened), the handler returns nothing and the model context is
untouched.

## Limitations

What the guard does and does not fix, stated plainly:

- What works end to end: the guard detects the flush race at session entry,
  notifies you with the one-line recovery notice, corrects the session manager
  state (resume leaf, entry index, session topology), and corrects the model's
  context on the first turn and every turn after, as described above.
- Disarm semantics, restated: the context swap is never manually disarmed. It
  degrades to a no-op by content equality after any runtime rebuild, and it is
  absent entirely (the handler returns nothing) in sessions where no entry
  check ever gained entries.
- The guard only runs at session entry (startup, reload, new, resume, fork).
  Mid-session races in OTHER live processes are still only detected at the
  next entry: if another pi process flushes new tail entries while this
  process keeps running, this process notices them only when it next enters a
  session. Detection stays entry-time-only by design.

## The manual command

`/sessionguard` reports the last check any time: the session file, the
session_start reason, the leaf and entry count before and after, the last entry
timestamp, the entries gained, or the reason a check skipped the reload.

## Layout

- `index.ts`: the extension (session_start check plus the `/sessionguard` command).
- `guard.ts`: the pure decision logic (no Pi imports), unit tested.
- `tests/sessionguard.test.ts`: pure-logic tests.
- `tests/run.ps1`: test runner (node strip-types, esbuild fallback).

Run the tests:

```
powershell -NoProfile -ExecutionPolicy Bypass -File extensions\sessionguard\tests\run.ps1
```
