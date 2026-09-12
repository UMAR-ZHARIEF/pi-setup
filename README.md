# pi-setup

Personal Pi harness package. It bundles the workflow guard extension, the file removal helper, prompts, and bootstrap scripts so the same setup can be installed on any machine.

## New machine setup

Requires Node 22.19 or newer.

- Windows: run `bootstrap\install.ps1`
- Linux: run `bootstrap\install.sh`

## Environment variables

- `PI_RECYCLE_HELPER`: optional override. Full path to a recycle helper script. When set, the guard extension points at it instead of the bundled one.
- `BRAVE_PATH`: full path to the Brave browser executable, for when it is not in the default location.
- `GITHUB_PERSONAL_ACCESS_TOKEN`: token used for GitHub access.

## Secrets

The zai key is not stored in this repo. Enter it on each machine with `/login zai`.

## Chat history

Chat history is intentionally per machine. It is not synced or copied between machines.
