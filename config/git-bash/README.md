# Git Bash standalone setup (colors, keybinds, Discord activity, pi integration)

This folder contains the complete standalone Git Bash configuration: matched
colors, Windows-style clipboard keys, terminal scroll keybinds, prompt markers,
a Discord activity launcher with a locked window title, and pi keybindings for
transcript navigation inside the terminal.

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
| `minttyrc` | Colors (#1c1620 bg), locked title, clipboard keys (Ctrl+C/V/A), scroll keys (Alt+PageUp/Down/Home/End, Alt+Shift+PageUp/Down), right Alt also acts as Alt for those keybinds (AltGrIsAlsoAlt=yes), no copy-on-select, no middle-click paste |
| `bashrc-snippet.sh` | Pins window title to "Git Bash" + plants mintty prompt markers (OSC ?7711h) enabling Alt+Shift+PageUp/Down prompt hopping |
| `pi-keybindings.json` | Six Alt keys mapped to pi's transcript scroll/jump/prompt-hop actions (works inside pi) |
| `vscode-terminal-keys.json` | Ctrl+C copy, Ctrl+V paste (native), Ctrl+A select all, Ctrl+Shift+A line start, Ctrl+Shift+C interrupt |
| `windows-terminal-keys.json` | Same pattern; note WT passes Ctrl+C through to shell when nothing selected (documented quirk) |
| `wrapper.cs` | C# launcher: starts mintty with locked title + correct icon, stays alive for Discord detection. Metadata FileDescription = "Git Bash" |
| `rpc.json` | Discord Rich Presence config (parked; see todo/discord-gitbash-presence.md) |

## Keybind reference

| Key | Bash prompt | Inside pi | VS Code terminal | Windows Terminal |
|-----|------------|-----------|------------------|-----------------|
| Ctrl+C | copy | copy (pi binding) | copy | copy (passes through if nothing selected) |
| Ctrl+V | paste | paste (mintty) | paste (native) | paste (default) |
| Ctrl+A | select all | shell line-start | select all | select all |
| Ctrl+Shift+A | line start | shell line-start | line start | line start |
| Ctrl+Shift+C | interrupt | shell interrupt | interrupt | interrupt |
| Alt+PageUp/Down | scroll line | scroll transcript line | scroll (VS Code) | scroll (WT) |
| Alt+Home/End | top/bottom | transcript top/bottom | top/bottom (VS Code) | top/bottom (WT) |
| Alt+Shift+PageUp/Down | prompt hop | message hop | prompt hop (VS Code) | prompt hop (WT) |

## Known quirks

- **Windows Terminal Ctrl+C pass-through**: WT's copy action passes unhandled
  Ctrl+C to the shell when nothing is selected; Ctrl+Shift+C is the explicit
  interrupt everywhere.
- **Full-screen apps own the screen**: Alt+scroll keys work at the bash prompt
  and scroll mintty's scrollback; full-screen apps (pi, vim) own the screen,
  so use the app's own navigation (inside pi, the Alt keys work via pi's
  keybindings). VS Code's terminal keeps its own buffer which is why the same
  keys appear to work there in all contexts.
- **Right Alt works like left Alt**: `AltGrIsAlsoAlt=yes` makes right Alt act
  as an Alt modifier for all the Alt-key bindings (scroll keys, prompt hops),
  while AltGr character composition still works as before.
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
