# Git Bash standalone setup (colors, keybinds, Discord activity, pi integration)

This folder contains the complete standalone Git Bash configuration: matched
colors, Windows-style clipboard keys, mintty's native scrolling with a
ScrollLock output freeze, prompt markers, a Discord activity launcher with a
locked window title, and pi keybindings for transcript navigation, cursor
line-start and word deletion inside the terminal.

## Quick setup (run on a fresh machine)

1. Copy `minttyrc` to `~/.minttyrc`.
2. Append `bashrc-snippet.sh` to `~/.bashrc`.
3. Merge `pi-keybindings.json` entries into `~/.pi/agent/keybindings.json`.
4. Build the Discord launcher:
   ```
   csc /nologo /target:winexe /out:"Git Bash.exe" /r:System.Windows.Forms.dll wrapper.cs
   ```
   Place the exe in `%LOCALAPPDATA%\Programs\GitBashDiscord\` alongside `rpc.json`.
5. Create a desktop shortcut named "Git Bash" targeting the exe.
6. Patch the Start Menu `Git Bash.lnk` (ProgramData, elevated) to the same exe.
7. In Discord: Registered Games → Add it! → "Git Bash".
8. Add the VS Code keybinds from `vscode-terminal-keys.json` to your
   `keybindings.json`; add the Windows Terminal entries from
   `windows-terminal-keys.json` to your `settings.json` actions array.

## What each piece does

| File | Purpose |
|------|---------|
| `minttyrc` | Colors (#1c1620 bg), locked title, clipboard keys (Ctrl+C/V/A), ScrollLock output freeze and Ctrl+Backspace remapped to ^W (KeyFunctions), no copy-on-select, no middle-click paste. Scrolling itself needs no config: it is mintty-native (Shift+PageUp/Down pages, Shift+Up/Down lines, Shift+Left/Right prompt hops) |
| `bashrc-snippet.sh` | Pins window title to "Git Bash" + plants mintty prompt markers (OSC ?7711h) enabling Shift+Left/Right prompt hopping (mintty native) |
| `pi-keybindings.json` | Eight keys mapped to pi's actions: six Alt keys for transcript scroll/jump/prompt-hop plus delete-word-backward and cursor line-start, bound to Ctrl+Backspace, Ctrl+W, Alt+Backspace and Ctrl+A (works inside pi) |
| `vscode-terminal-keys.json` | Ctrl+C copy, Ctrl+V paste (native), Ctrl+A select all, Ctrl+Shift+A line start, Ctrl+Shift+C interrupt |
| `windows-terminal-keys.json` | Same pattern; note WT passes Ctrl+C through to shell when nothing selected (documented quirk) |
| `wrapper.cs` | C# launcher: starts mintty with locked title + correct icon, stays alive for Discord detection. Metadata FileDescription = "Git Bash" |
| `rpc.json` | Discord Rich Presence config (parked; see todo/discord-gitbash-presence.md) |

## Keybind reference

| Key | Bash prompt | Inside pi | VS Code terminal | Windows Terminal |
|-----|------------|-----------|------------------|-----------------|
| Ctrl+C | copy | copy (pi binding) | copy | copy (passes through if nothing selected) |
| Ctrl+V | paste | paste (mintty) | paste (native) | paste (default) |
| Ctrl+A | select all | line start (input box) | select all | select all |
| Ctrl+Shift+A | line start | line start (input box) | line start | line start |
| Ctrl+Shift+C | interrupt | shell interrupt | interrupt | interrupt |
| Shift+PageUp/PageDown | scroll page up/down (mintty native) | not used (pi scrolls itself; see Alt rows) | not remapped here | not remapped here |
| Shift+Up/Down | scroll line up/down (mintty native) | not used (pi scrolls itself; see Alt rows) | not remapped here | not remapped here |
| Shift+Left/Right | hop to previous/next prompt (mintty native, uses the planted prompt markers) | moves the cursor (pi input) | not remapped here | not remapped here |
| Alt+PageUp/Down | no mintty binding: the combo reaches the app | scroll transcript line up/down (pi keybindings) | not bound | not bound |
| Alt+Home/End | no mintty binding: the combo reaches the app | transcript top/bottom (pi keybindings) | not bound | not bound |
| Alt+Shift+PageUp/Down | no mintty binding: the combo reaches the app | previous/next prompt hop (pi keybindings) | not bound | not bound |
| ScrollLock | freeze output: view stays put while output streams; press again to release (mintty native; ScrollLock LED reflects the state) | same terminal-level freeze still works | n/a | n/a |
| Ctrl+Backspace | delete word backward (via the mintty ^W remap) | delete word backward (via the mintty ^W remap) | delete word (native) | delete word (native) |

## Known quirks

- **Windows Terminal Ctrl+C pass-through**: WT's copy action passes unhandled
  Ctrl+C to the shell when nothing is selected; Ctrl+Shift+C is the explicit
  interrupt everywhere.
- **Ctrl+A and Ctrl+Shift+A are line start inside pi**: plain Ctrl+A at the
  bash prompt remains mintty select-all; inside pi both Ctrl+A and
  Ctrl+Shift+A are line start because mintty delivers both as the same
  control character.
- **Full-screen apps own the screen**: scrolling is mintty-native at the bash
  prompt (Shift+PageUp/Down pages, Shift+Up/Down lines, Shift+Left/Right
  prompt hops); full-screen apps (pi, vim) own the screen, so use the app's
  own navigation (inside pi, the Alt keys work via pi's keybindings, which the
  terminal passes through). VS Code's terminal keeps its own buffer which is
  why scrolling works there in all contexts.
- **ScrollLock freezes streaming output**: press ScrollLock once while output
  streams and the view stays put, so you can scroll up and read while output
  keeps accumulating; press ScrollLock again to release and return to live.
  mintty drives the ScrollLock keyboard LED to reflect the lock state.
- **The old mintty Alt scroll bindings never worked**: the previous
  `A+Prior/A+Next/A+Home/A+End/AS+Prior/AS+Next` KeyFunctions entries were
  dead in this mintty 3.8.1 build. A probe that injects the keys into a live
  window showed Alt+PageUp/Alt+Home passing through unbound in every config
  variant, including the original one that shipped them, while Ctrl+C stayed
  bound (probe evidence: `pi-setup(chat)/.pi/plans/scroll-keys-diagnosis.md`).
  The dead entries are removed; they were replaced by the native Shift keys
  above, not by new mintty bindings.
- **Right Alt already acts as Alt natively**: on this layout the right Alt key
  emits plain Alt encodings (probe-proven: right-Alt+PageUp arrives as
  `^[[5;3~`, right-Alt+U as `^[u`, with no config line involved), so the old
  `AltGrIsAlsoAlt=yes` line was dropped as redundant. Unbound Alt combos
  passing through is exactly what lets pi bind them inside.
- **Ctrl+Backspace deletes a word via a ^W remap**: mintty sends Ctrl+Backspace
  as plain byte 0x08, the same byte as Backspace, and outside Windows Terminal
  pi reads that as a single-character backspace. The minttyrc therefore remaps
  Ctrl+Backspace to ^W: pi binds ctrl+w to delete-word-backward, and bash
  treats ^W as delete-to-previous-space, so the same tap deletes one word at
  the prompt and inside pi (Windows Terminal and VS Code handle it natively
  and are unaffected). WARNING: the `C+Back:"..."` entry in the minttyrc
  KeyFunctions line contains ONE raw 0x17 control byte. Never "clean" that
  entry or re-type it as an escape sequence such as `\x17` or the two
  characters `^W`: mintty has no escape notation in config strings, so only
  the literal raw byte works.
- **Discord icon (parked)**: the wrapper's Discord status shows a question
  mark icon because manually-added games cannot have custom icons in Discord.
  The fix (Rich Presence with an uploaded asset) is parked; see
  `todo/discord-gitbash-presence.md`.

## Launch habit

Open Git Bash via the **"Git Bash" desktop shortcut** or the patched **Start
Menu entry** (both point to the wrapper). This ensures the locked title and
Discord activity. Opening via the old Start Menu path or a raw `bash` command
still works as a terminal but does not get the locked title or Discord
detection.
