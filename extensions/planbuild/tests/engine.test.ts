import test from "node:test";
import assert from "node:assert/strict";
import { wildcardMatch, mergeRuleSets, evaluate, type Rule } from "../engine.ts";

test("wildcard * matches any characters including slashes", () => {
  assert.equal(wildcardMatch("*", "src/app.ts"), true);
  assert.equal(wildcardMatch("*", ".pi/plans/plan-1.md"), true);
  assert.equal(wildcardMatch("src/*", "src/a/b/deep/file.ts"), true);
  assert.equal(wildcardMatch(".pi/plans/*", ".pi/plans/nested/plan-1.md"), true);
  assert.equal(wildcardMatch("a*/*c", "a/x/y/z/bc"), true);
});

test("wildcard ? matches exactly one character", () => {
  assert.equal(wildcardMatch("?", "a"), true);
  assert.equal(wildcardMatch("?", ""), false);
  assert.equal(wildcardMatch("file?.txt", "file1.txt"), true);
  assert.equal(wildcardMatch("file?.txt", "file12.txt"), false);
  assert.equal(wildcardMatch("a?c", "abc"), true);
});

test("literal patterns are exact and reject mismatches", () => {
  assert.equal(wildcardMatch("cat", "cat"), true);
  assert.equal(wildcardMatch("git status", "git status"), true);
  assert.equal(wildcardMatch("dog", "cat"), false);
  assert.equal(wildcardMatch("cat", "concatenate"), false);
  assert.equal(wildcardMatch("cat", "ca"), false);
});

test("matching is case sensitive", () => {
  assert.equal(wildcardMatch("ABC", "ABC"), true);
  assert.equal(wildcardMatch("Git", "git"), false);
  assert.equal(wildcardMatch("README.md", "readme.md"), false);
  assert.equal(wildcardMatch("Get-Content", "get-content"), false);
});

test("evaluate returns ask when no rule matches", () => {
  assert.equal(evaluate("bash", "ls", []), "ask");
  const rules: Rule[] = [
    { tool: "edit", pattern: ".pi/plans/*", action: "allow" },
    { tool: "bash", pattern: "git *", action: "deny" },
  ];
  assert.equal(evaluate("edit", "src/app.ts", rules), "ask");
  assert.equal(evaluate("bash", "npm install", rules), "ask");
});

test("evaluate last matching rule wins with two matching rules", () => {
  const rules: Rule[] = [
    { tool: "*", pattern: "*", action: "allow" },
    { tool: "*", pattern: "*", action: "deny" },
  ];
  assert.equal(evaluate("bash", "ls", rules), "deny");
  const reversed: Rule[] = [rules[1], rules[0]];
  assert.equal(evaluate("bash", "ls", reversed), "allow");
});

test("evaluate earlier deny overridden by later allow", () => {
  const rules: Rule[] = [
    { tool: "edit", pattern: "*", action: "deny" },
    { tool: "edit", pattern: "*", action: "allow" },
  ];
  assert.equal(evaluate("edit", "anything.md", rules), "allow");
});

test("evaluate tool wildcard matches any tool", () => {
  const rules: Rule[] = [{ tool: "*", pattern: "*", action: "deny" }];
  assert.equal(evaluate("bash", "ls", rules), "deny");
  assert.equal(evaluate("edit", ".pi/plans/plan-1.md", rules), "deny");
  assert.equal(evaluate("web-fetch", "https://example.com", rules), "deny");
  const prefix: Rule[] = [{ tool: "git*", pattern: "*", action: "deny" }];
  assert.equal(evaluate("github", "repo", prefix), "deny");
  assert.equal(evaluate("npm", "install", prefix), "ask");
});

test("plan file rule pair allows plan files and denies other edits", () => {
  const rules: Rule[] = [
    { tool: "edit", pattern: "*", action: "deny" },
    { tool: "edit", pattern: ".pi/plans/*", action: "allow" },
  ];
  assert.equal(evaluate("edit", ".pi/plans/plan-1.md", rules), "allow");
  assert.equal(evaluate("edit", ".pi/plans/nested/plan-2.md", rules), "allow");
  assert.equal(evaluate("edit", "src/app.ts", rules), "deny");
  assert.equal(evaluate("edit", "src/.pi/plans/x.md", rules), "deny");
  assert.equal(evaluate("read", ".pi/plans/plan-1.md", rules), "ask");
});

test("mergeRuleSets flattens rule sets preserving order", () => {
  const a: Rule[] = [{ tool: "edit", pattern: "*", action: "deny" }];
  const b: Rule[] = [{ tool: "edit", pattern: ".pi/plans/*", action: "allow" }];
  const c: Rule[] = [{ tool: "bash", pattern: "git *", action: "deny" }];
  const merged = mergeRuleSets(a, b, c);
  assert.equal(merged.length, 3);
  assert.deepEqual(merged, [a[0], b[0], c[0]]);
  assert.deepEqual(mergeRuleSets(a, [], c), [a[0], c[0]]);
  assert.deepEqual(mergeRuleSets(), []);
});

test("evaluate honors later rules from merged sets", () => {
  const base: Rule[] = [{ tool: "edit", pattern: "*", action: "deny" }];
  const override: Rule[] = [{ tool: "edit", pattern: ".pi/plans/*", action: "allow" }];
  const merged = mergeRuleSets(base, override);
  assert.equal(evaluate("edit", ".pi/plans/plan-1.md", merged), "allow");
  assert.equal(evaluate("edit", "src/app.ts", merged), "deny");
  const swapped = mergeRuleSets(override, base);
  assert.equal(evaluate("edit", ".pi/plans/plan-1.md", swapped), "deny");
});

test("catch-all ask first: builtins allowed, unknown tools ask, edits gated, custom rules win", () => {
  const builtin: Rule[] = [
    { tool: "*", pattern: "*", action: "ask" },
    { tool: "read", pattern: "*", action: "allow" },
    { tool: "grep", pattern: "*", action: "allow" },
    { tool: "find", pattern: "*", action: "allow" },
    { tool: "ls", pattern: "*", action: "allow" },
    { tool: "edit", pattern: "*", action: "deny" },
    { tool: "edit", pattern: ".pi/plans/*", action: "allow" },
    { tool: "write", pattern: "*", action: "deny" },
    { tool: "write", pattern: ".pi/plans/*", action: "allow" },
    { tool: "bash", pattern: "*", action: "deny" },
    { tool: "powershell", pattern: "*", action: "deny" },
    { tool: "subagent", pattern: "worker", action: "deny" },
    { tool: "plan_exit", pattern: "*", action: "allow" },
  ];
  assert.equal(evaluate("read", ".pi/plans/plan.md", builtin), "allow");
  assert.equal(evaluate("grep", "pattern", builtin), "allow");
  assert.equal(evaluate("find", ".", builtin), "allow");
  assert.equal(evaluate("ls", ".", builtin), "allow");
  assert.equal(evaluate("mcp__serena__replace_content", "*", builtin), "ask");
  assert.equal(evaluate("webfetch", "https://example.com", builtin), "ask");
  assert.equal(evaluate("edit", "src/app.ts", builtin), "deny");
  assert.equal(evaluate("edit", ".pi/plans/plan.md", builtin), "allow");
  assert.equal(evaluate("write", "src/app.ts", builtin), "deny");
  assert.equal(evaluate("write", ".pi/plans/plan.md", builtin), "allow");
  const custom: Rule[] = [{ tool: "mcp__serena__replace_content", pattern: "*", action: "allow" }];
  const merged = mergeRuleSets(builtin, custom);
  assert.equal(evaluate("mcp__serena__replace_content", "*", merged), "allow");
  assert.equal(evaluate("mcp__other__tool", "*", merged), "ask");
});
