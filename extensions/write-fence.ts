/**
 * Write Fence Extension
 *
 * Fences write and edit tool calls to an allowlist of roots: the session working
 * folder, the OS temp dir, the ~/.pi/agent dir, and any semicolon separated
 * entries in PI_WRITE_EXTRA. Loaded only in subagent child sessions via
 * subagentOnlyExtensions, so it is self-contained, fails closed, and uses no UI.
 * Reads are never touched. Set PI_WRITE_FENCE=off to disable the fence entirely.
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent"
import { realpathSync, sep } from "node:fs"
import { resolve, dirname, basename } from "node:path"
import { homedir, tmpdir } from "node:os"

function targetFilePath(input: unknown): string {
	const args = (input ?? {}) as Record<string, unknown>
	const raw = args.path ?? args.file_path ?? args.filePath ?? args.relative_path
	return typeof raw === "string" ? raw : ""
}

function normalizePath(absolute: string): string {
	let current = resolve(absolute)
	const tail: string[] = []
	while (true) {
		try {
			const real = realpathSync(current)
			return (tail.length ? real + sep + tail.join(sep) : real).toLowerCase()
		} catch {
			const parent = dirname(current)
			if (parent === current) return resolve(absolute).toLowerCase()
			tail.unshift(basename(current))
			current = parent
		}
	}
}

function expandHome(entry: string): string {
	if (entry === "~") return homedir()
	if (entry.startsWith("~/") || entry.startsWith("~\\")) return resolve(homedir(), entry.slice(2))
	return entry
}

export default function (pi: ExtensionAPI) {
	if (process.env.PI_WRITE_FENCE === "off") return

	const extraRaw = typeof process.env.PI_WRITE_EXTRA === "string" ? process.env.PI_WRITE_EXTRA : ""
	const allowedRoots = [process.cwd(), tmpdir(), resolve(homedir(), ".pi", "agent")]
		.concat(
			extraRaw
				.split(";")
				.map((entry) => entry.trim())
				.filter(Boolean)
				.map((entry) => resolve(expandHome(entry))),
		)
		.map((root) => normalizePath(root))

	pi.on("tool_call", async (event) => {
		try {
			const toolName = String(event.toolName ?? "")
			if (toolName !== "write" && toolName !== "edit") return undefined
			const rawPath = targetFilePath(event.input)
			if (!rawPath) return undefined
			const normalized = normalizePath(resolve(process.cwd(), rawPath))
			const allowed = allowedRoots.some((root) => {
				if (normalized === root) return true
				const prefix = root.endsWith(sep) ? root : root + sep
				return normalized.startsWith(prefix)
			})
			if (allowed) return undefined
			return {
				block: true,
				reason: `Write fence: ${rawPath} resolves outside the session working folder and the allowed roots (working folder, temp, Pi agent dir, PI_WRITE_EXTRA). Nothing was written. Ask the orchestrator or the user to perform this write, or ask them to add the destination to PI_WRITE_EXTRA.`,
			}
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error)
			return {
				block: true,
				reason: `Write fence: internal error (${detail}); the fence itself failed and the write was refused. Nothing was written.`,
			}
		}
	})
}
