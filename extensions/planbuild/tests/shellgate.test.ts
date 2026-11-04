import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectBashCommand, inspectPowershellCommand, loadExtraSafeCommands } from "../shellgate.ts";

const bashAllowed = [
  "ls",
  "cat notes.txt",
  "git status",
  "git log",
  "git diff",
  "rg pattern .",
  "pwd",
  "node --version",
  "cat a.txt | wc -l",
];

const bashDenied: Array<[string, string]> = [
  ["npm install", "npm install"],
  ["py -c print(1)", "py -c print(1)"],
  ["node script.js", "node script.js"],
  ["git commit -m x", "git commit -m x"],
  ["git push", "git push"],
  ["git log --oneline -5", "git log --oneline -5 (extra flags on git)"],
  ["mkdir d", "mkdir d"],
  ["curl http://x", "curl http://x"],
  ["echo hi > f.txt", "echo hi > f.txt (redirection)"],
  ["cat a | sh", "cat a | sh (pipe to sh)"],
  ["$(git status)", "$(git status) (command substitution)"],
  ["git status && npm install", "git status && npm install"],
  ["git -C ../other status", "git -C ../other status"],
  ["", "(empty string)"],
  ["   ", "(whitespace only)"],
];

const powershellAllowed = [
  "Get-Content file.txt",
  "Get-ChildItem",
  "Select-String -Pattern x file.txt",
  "git status",
  "Get-ChildItem | Measure-Object",
  "node --version",
];

const powershellDenied: Array<[string, string]> = [
  ["gc file.txt", "gc file.txt (alias)"],
  ["Get-Content f | Set-Content g", "Get-Content f | Set-Content g (writes)"],
  ["$x = 1", "$x = 1 (assignment)"],
  ["Invoke-Expression x", "Invoke-Expression x"],
  ["New-Item thing", "New-Item thing"],
  ["Get-Content f > out.txt", "Get-Content f > out.txt (redirection)"],
  ["Get-Item { }", "Get-Item { } (script block)"],
  ["git commit -m x", "git commit -m x"],
  ["", "(empty string)"],
];

for (const cmd of bashAllowed) {
  test(`bash allows: ${cmd}`, () => {
    const verdict = inspectBashCommand(cmd);
    assert.equal(verdict.allowed, true);
    assert.equal(typeof verdict.reason, "string");
  });
}

for (const [cmd, label] of bashDenied) {
  test(`bash denies: ${label}`, () => {
    const verdict = inspectBashCommand(cmd);
    assert.equal(verdict.allowed, false);
    assert.equal(typeof verdict.reason, "string");
  });
}

for (const cmd of powershellAllowed) {
  test(`powershell allows: ${cmd}`, () => {
    const verdict = inspectPowershellCommand(cmd);
    assert.equal(verdict.allowed, true);
    assert.equal(typeof verdict.reason, "string");
  });
}

for (const [cmd, label] of powershellDenied) {
  test(`powershell denies: ${label}`, () => {
    const verdict = inspectPowershellCommand(cmd);
    assert.equal(verdict.allowed, false);
    assert.equal(typeof verdict.reason, "string");
  });
}

test("loadExtraSafeCommands returns empty array when config file is missing", () => {
  const missing = join(tmpdir(), "pb-c2-missing-extra-safe.json");
  assert.deepEqual(loadExtraSafeCommands(missing), []);
});

test("loadExtraSafeCommands returns empty array when key is absent", () => {
  const configPath = join(tmpdir(), "pb-c2-extra-safe.json");
  writeFileSync(configPath, JSON.stringify({ unrelatedKey: ["x"] }), "utf8");
  assert.deepEqual(loadExtraSafeCommands(configPath), []);
});
