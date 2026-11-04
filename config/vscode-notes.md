# Machine configuration outside Pi

This file documents settings that live OUTSIDE the Pi agent directory but are required for the full Pi experience to work on this machine. A fresh machine rebuilt from this book needs these applied manually.

## Required: BRAVE_PATH environment variable

The Pi MCP config template (config/mcp.json) starts four Playwright browser
servers. Each one uses ${BRAVE_PATH} to locate the browser executable.

If BRAVE_PATH is not set as a Windows user environment variable, all four
Playwright servers will fail to start with a "browser executable not found"
error, and Pi will have zero browser tools.

To set it, run this command once in any terminal, then restart the terminal:

  setx BRAVE_PATH "C:/Program Files/BraveSoftware/Brave-Browser/Application/brave.exe"

Verify it is set by opening a NEW terminal and running:

  echo %BRAVE_PATH%

It should print the path above. If it prints %BRAVE_PATH%, the variable is
not set and the Playwright servers will not work.

Note: the live config on the original machine hardcodes the browser path
directly in mcp.json and does not use BRAVE_PATH. Only the book template
uses it. If you are rebuilding from this book, you MUST set BRAVE_PATH
BEFORE starting Pi for the first time.

## VS Code settings (user settings.json)

These three keys must be present in the VS Code user settings file
(AppData/Roaming/Code/User/settings.json):

1. "terminal.integrated.minimumContrastRatio": 1
   Prevents VS Code from washing out pink and purple terminal colors.

2. "terminal.integrated.scrollback": 10000
   Gives the terminal 10000 lines of scrollback history instead of the
   default 1000.

3. "workbench.colorCustomizations": { "[Neon Pink Dark]": { "terminal.background": "#1c1620" } }
   Makes the VS Code terminal background plum (#1c1620) when the Neon Pink
   Dark theme is active, so the Pi sakura-dusk theme panels sit on the
   correct canvas color.

## Windows Terminal settings

In Windows Terminal (Settings, profiles, defaults), set:
  "background": "#1c1620"
This gives every profile (PowerShell, CMD, etc.) the same plum canvas.
