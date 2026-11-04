import { readFileSync } from "node:fs";

export interface ShellVerdict {
	allowed: boolean;
	reason: string;
}

const BASH_FIRST_TOKENS = new Set([
	"ls",
	"cat",
	"head",
	"tail",
	"wc",
	"file",
	"pwd",
	"which",
	"echo",
	"rg",
	"grep",
	"find",
]);

const GIT_READ_SUBCOMMANDS = new Set(["status", "log", "diff", "show", "branch", "rev-parse"]);

const PS_CMDLETS = new Set([
	"get-content",
	"get-childitem",
	"get-item",
	"select-string",
	"get-location",
	"measure-object",
	"sort-object",
	"where-object",
	"format-list",
	"format-table",
	"compare-object",
	"get-date",
]);

const extraTokens = new Set<string>();

export function loadExtraSafeCommands(configPath: string): string[] {
	extraTokens.clear();
	let raw: string;
	try {
		raw = readFileSync(configPath, "utf8");
	} catch {
		return [];
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return [];
	}
	const list = (parsed as { extraSafeShellCommands?: unknown } | null)?.extraSafeShellCommands;
	if (!Array.isArray(list)) return [];
	const cleaned: string[] = [];
	for (const item of list) {
		if (typeof item !== "string") continue;
		const name = item.trim();
		if (!name) continue;
		cleaned.push(name);
		extraTokens.add(name);
	}
	return cleaned;
}

function hasExtra(name: string, caseInsensitive: boolean): boolean {
	if (extraTokens.has(name)) return true;
	if (!caseInsensitive) return false;
	const lower = name.toLowerCase();
	for (const token of extraTokens) {
		if (token.toLowerCase() === lower) return true;
	}
	return false;
}

function structuralDenyReason(command: string): string | undefined {
	if (command.trim().length === 0) return "empty command";
	if (command.includes("$(")) return "command substitution $() is not allowed";
	if (command.includes("`")) return "backtick command substitution is not allowed";
	if (command.includes(">") || command.includes("<")) return "redirection is not allowed";
	if (command.includes("(") || command.includes(")")) return "subshell parentheses are not allowed";
	if (/\$[A-Za-z]/.test(command)) return "variable expansion is not allowed";
	if (command.includes("{") || command.includes("}")) return "script block braces are not allowed";
	const withoutChains = command.replaceAll("&&", "").replaceAll("||", "");
	if (withoutChains.includes("&")) return "background/call operator (&) is not allowed";
	if (/invoke-expression/i.test(command)) return "Invoke-Expression is not allowed";
	return undefined;
}

function splitSegments(command: string): string[] {
	return command
		.replaceAll("&&", "\n")
		.replaceAll("||", "\n")
		.split(/[;\n|]/)
		.map((segment) => segment.trim());
}

function tokenize(segment: string): string[] {
	return segment.split(/\s+/).filter((token) => token.length > 0);
}

function gitSegmentAllowed(tokens: string[]): boolean {
	if (tokens.length < 2) return false;
	for (const token of tokens.slice(1)) {
		if (token.startsWith("-C")) return false;
	}
	const sub = tokens[1];
	if (tokens.length === 2 && GIT_READ_SUBCOMMANDS.has(sub)) return true;
	if (tokens.length === 3 && sub === "remote" && tokens[2] === "-v") return true;
	return false;
}

function versionSegmentAllowed(tokens: string[]): boolean {
	return tokens.length === 2 && tokens[1] === "--version";
}

function denySegment(segment: string, why: string): ShellVerdict {
	return { allowed: false, reason: `blocked segment "${segment}": ${why}` };
}

export function inspectBashCommand(command: string): ShellVerdict {
	const structural = structuralDenyReason(command);
	if (structural) return { allowed: false, reason: structural };
	const segments = splitSegments(command);
	if (segments.length === 0) return { allowed: false, reason: "empty command" };
	for (const segment of segments) {
		const tokens = tokenize(segment);
		if (tokens.length === 0) return denySegment(segment, "empty segment");
		const first = tokens[0];
		if (versionSegmentAllowed(tokens)) continue;
		if (first === "git") {
			if (!gitSegmentAllowed(tokens)) {
				return denySegment(segment, "git is limited to one read subcommand (status, log, diff, show, branch, remote -v, rev-parse) and git -C is denied");
			}
			continue;
		}
		if (BASH_FIRST_TOKENS.has(first) || hasExtra(first, false)) continue;
		return denySegment(segment, `first token "${first}" is not on the bash read-only allowlist`);
	}
	return { allowed: true, reason: "ok" };
}

export function inspectPowershellCommand(command: string): ShellVerdict {
	const structural = structuralDenyReason(command);
	if (structural) return { allowed: false, reason: structural };
	const segments = splitSegments(command);
	if (segments.length === 0) return { allowed: false, reason: "empty command" };
	for (const segment of segments) {
		const tokens = tokenize(segment);
		if (tokens.length === 0) return denySegment(segment, "empty segment");
		const first = tokens[0];
		if (versionSegmentAllowed(tokens)) continue;
		if (first === "git") {
			if (!gitSegmentAllowed(tokens)) {
				return denySegment(segment, "git is limited to one read subcommand (status, log, diff, show, branch, remote -v, rev-parse) and git -C is denied");
			}
			continue;
		}
		const canonical = first.toLowerCase();
		if (PS_CMDLETS.has(canonical) || hasExtra(first, true)) continue;
		return denySegment(segment, `first token "${first}" is not a canonical allowlisted cmdlet (aliases are denied)`);
	}
	return { allowed: true, reason: "ok" };
}
