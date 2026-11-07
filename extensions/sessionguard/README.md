# sessionguard

Closes the session-file flush race at session entry. If pi ever resumes a
session and some of the newest conversation is missing, sessionguard detects it
at startup, re-reads the session file, and pulls the missing entries back in.
You see one line when it recovers something, and silence when all is well.

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

## Limitations

What the guard does and does not fix, stated plainly:

- What works: the guard detects the flush race at session entry, notifies you
  with the one-line recovery notice, and corrects the session manager state:
  the resume leaf, the entry index, and the session topology. After the guard
  runs, the session manager holds the complete entry set and the resume point
  sits on the true last entry.
- What still has a gap: the first turn after a racy restart may still answer
  from the stale context. The agent runtime caches its message list at initial
  load, and it does not rebuild that list when an extension reloads the session
  manager mid-session_start. The guard's re-read happens inside that same
  session_start event, so the recovery is visible to the session manager but
  not yet to the model's context on that first turn. This is exactly what the
  live replay showed: the recovery notice, leaf move, and topology were all
  correct, while the first-turn answer still came from the pre-reload snapshot
  (scratch\sessionguard-w2.md, p1-cure-q1 and p1-cure-q2).
- What makes the gap disappear: a second restart, or any subsequent session
  entry (new, resume, fork), sees the complete state, because the next load
  builds its context from the corrected session manager state.
- Follow-up: investigation of a context-rebuild path (making the first turn's
  model context follow the recovered state instead of the cached snapshot) is
  tracked as a follow-up.

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
