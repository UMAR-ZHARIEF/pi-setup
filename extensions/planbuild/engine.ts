// planbuild rule engine: wildcard matching and last-match-wins rule evaluation.
// Semantics ported from opencode v1.19.5 (MIT, github.com/anomalyco/opencode) and Pi's plan-mode example (MIT).

export type RuleAction = "allow" | "ask" | "deny";

export interface Rule {
	tool: string;
	pattern: string;
	action: RuleAction;
}

export function wildcardMatch(pattern: string, text: string): boolean {
	let p = 0;
	let t = 0;
	let star = -1;
	let mark = 0;
	while (t < text.length) {
		if (p < pattern.length && (pattern[p] === "?" || pattern[p] === text[t])) {
			p++;
			t++;
		} else if (p < pattern.length && pattern[p] === "*") {
			star = p;
			p++;
			mark = t;
		} else if (star !== -1) {
			p = star + 1;
			mark++;
			t = mark;
		} else {
			return false;
		}
	}
	while (p < pattern.length && pattern[p] === "*") p++;
	return p === pattern.length;
}

export function mergeRuleSets(...sets: Rule[][]): Rule[] {
	return sets.flat();
}

export function evaluate(tool: string, subject: string, rules: Rule[]): RuleAction {
	for (let i = rules.length - 1; i >= 0; i--) {
		const rule = rules[i];
		if (!rule) continue;
		if (wildcardMatch(rule.tool, tool) && wildcardMatch(rule.pattern, subject)) {
			return rule.action;
		}
	}
	return "ask";
}
