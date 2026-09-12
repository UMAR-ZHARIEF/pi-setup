/**
 * Workflow Guards Extension
 *
 * Five guards:
 * 1. Deletion gatekeeper for bash/powershell commands
 * 2. Blocks direct writes to .serena/memories
 * 3. Interactive approval gate for reading .env files
 * 4. Memory staging queue under .pi/state
 * 5. Standing instructions injected before each agent run
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

type MemoryEntry = {
	tool: string
	summary: string
	priority: "HIGH" | "CRITICAL"
	timestamp: string
	status: "pending" | "saved"
	isError: boolean
}

const memoryTrigger = /(^|\s)(remember\b|save (this|that|it|to serena|to memory)|note (this|that)|don['’]t forget|do not forget|memori[sz]e|keep (this|that)\b|important:|!save|!remember)/im
const importantCommand = /(git commit|git push|npm publish|docker push|kubectl apply|terraform apply|deploy|migrate|alembic upgrade)/i
const errorResult = /(error|exception|failed|traceback|denied)/i
const serenaMemoryTool = /serena/i
const serenaMemoryWrite = /(write|edit)_memory/i
const ignorableTools = new Set(["todowrite", "glob", "grep", "read", "task", "question", "skill"])
const editTools = new Set(["edit", "write", "patch", "apply_patch"])
const shellTools = new Set(["bash", "powershell"])
function recycleHelperText(): string {
	const override = process.env.PI_RECYCLE_HELPER
	if (override) return `powershell -NoProfile -File "${override}" <path> [-Force] [-DryRun]`
	if (process.platform === "win32") {
		const helperPath = join(dirname(fileURLToPath(import.meta.url)), "..", "helpers", "recycle.ps1")
		return `powershell -NoProfile -ExecutionPolicy Bypass -File "${helperPath}" <path> [-Force] [-DryRun]`
	}
	return "trash <path> (install trash-cli if missing)"
}

const recycleHelperGuidance = recycleHelperText()

function deletionVerb(command: string): string | undefined {
	const stripped = command.replace(/\\(["'])/g, "$1").replace(/"[^"]*"/g, '""').replace(/'[^']*'/g, "''")
	const inlineInterpreter = /(?:^|[^\w-])(py|python\d*|pwsh|powershell|node|perl|ruby)(\.exe)?\b[^\r\n]*\s(-c|-Command|-e)\b/i.test(command)
	const input = inlineInterpreter ? command : stripped
	const patterns = [
		/(?:^|[;&|]|\$\(|\n)\s*(Remove-Item|rmdir|del|erase|rd|rm|unlink)(?![\w-])/i,
		/(?:^|[;&|]|\$\(|\n)\s*Clear-Content(?![\w-])/i,
		/\[\s*(System\.)?IO\.(File|Directory)\s*\]::\s*Delete/i,
		/shutil\.rmtree|os\.remove|os\.unlink|os\.rmdir|pathlib.*\.unlink/i,
		/\.\s*(rmSync|rmdirSync|unlinkSync)\s*\(|fs\s*\.\s*(promises\s*\.\s*)?(rm|rmdir|unlink)(Sync)?\s*\(|(?:^|[^\w-])rimraf(?![\w-])/i,
		/(?:^|[^\w-])-delete(?![\w-])/i,
		/(?:^|[;&|]|\$\(|\n)\s*git\s+clean(?![\w-])/i,
	]
	return patterns.map((pattern) => input.match(pattern)?.[0]?.trim()).find(Boolean)
}

function isMemoryPath(path: string): boolean {
	return path.replaceAll("\\", "/").includes(".serena/memories/")
}

function isEnvFile(path: string): boolean {
	const normalized = path.replaceAll("\\", "/").toLowerCase()
	const isEnv = /(^|\/)\.env$/.test(normalized) || /\.env\.[^/]+$/.test(normalized)
	const isExample = /\.env\.example$/.test(normalized)
	return isEnv && !isExample
}

function targetFilePath(input: unknown): string {
	const args = (input ?? {}) as Record<string, unknown>
	const raw = args.path ?? args.file_path ?? args.filePath ?? args.relative_path
	return typeof raw === "string" ? raw : ""
}

function resultText(result: unknown): string {
	if (typeof result === "string") return result
	if (result && typeof result === "object") {
		const content = (result as Record<string, unknown>).content
		if (Array.isArray(content)) {
			return content
				.filter((part) => {
					const record = part as Record<string, unknown>
					return record && record.type === "text" && typeof record.text === "string"
				})
				.map((part) => (part as Record<string, unknown>).text as string)
				.join("\n")
		}
		try {
			return JSON.stringify(result) ?? ""
		} catch {
			return ""
		}
	}
	return `${result ?? ""}`
}

export default function (pi: ExtensionAPI) {
	const stateDir = join(process.cwd(), ".pi", "state")
	const queuePath = join(stateDir, "pending-memory.jsonl")
	const counterPath = join(stateDir, "critical-counter.txt")
	const callInputs = new Map<string, Record<string, unknown>>()

	const ensureState = () => {
		try {
			mkdirSync(stateDir, { recursive: true })
		} catch (error) {
			console.error("[workflow-guards] could not create state directory:", error)
		}
	}

	const readQueue = (): MemoryEntry[] => {
		try {
			if (!existsSync(queuePath)) return []
			return readFileSync(queuePath, "utf8")
				.split(/\r?\n/)
				.filter(Boolean)
				.flatMap((line) => {
					try {
						return [JSON.parse(line) as MemoryEntry]
					} catch {
						return []
					}
				})
		} catch (error) {
			console.error("[workflow-guards] could not read memory queue:", error)
			return []
		}
	}

	const writeQueue = (entries: MemoryEntry[]) => {
		try {
			ensureState()
			writeFileSync(queuePath, entries.map((entry) => JSON.stringify(entry)).join("\n") + (entries.length ? "\n" : ""), "utf8")
		} catch (error) {
			console.error("[workflow-guards] could not write memory queue:", error)
		}
	}

	const appendQueue = (entry: MemoryEntry) => {
		try {
			ensureState()
			appendFileSync(queuePath, `${JSON.stringify(entry)}\n`, "utf8")
		} catch (error) {
			console.error("[workflow-guards] could not append to memory queue:", error)
		}
	}

	const pendingEntries = () => readQueue().filter((entry) => entry.status === "pending")

	const clearState = () => {
		try {
			rmSync(queuePath, { force: true })
			rmSync(counterPath, { force: true })
		} catch (error) {
			console.error("[workflow-guards] could not clear state files:", error)
		}
	}

	const consumeCriticalCounter = (): number => {
		try {
			if (!existsSync(counterPath)) return 0
			const count = Number.parseInt(readFileSync(counterPath, "utf8").trim(), 10)
			if (!Number.isFinite(count) || count <= 0) return 0
			if (count === 1) rmSync(counterPath, { force: true })
			else writeFileSync(counterPath, String(count - 1), "ascii")
			return count
		} catch (error) {
			console.error("[workflow-guards] could not consume critical counter:", error)
			return 0
		}
	}

	// Guards 1, 2, 3: tool_call gate for shell commands, memory writes, and .env reads
	pi.on("tool_call", async (event, ctx) => {
		try {
			const toolName = String(event.toolName ?? "")
			const toolCallId = typeof event.toolCallId === "string" ? event.toolCallId : ""
			const input = (event.input ?? {}) as Record<string, unknown>
			if (toolCallId) callInputs.set(toolCallId, input)

			if (shellTools.has(toolName)) {
				const command = typeof input.command === "string" ? input.command : ""
				if (!command) return undefined
				const hit = deletionVerb(command)
				if (hit) {
					return {
						block: true,
						reason: `Deletion command blocked (matched '${hit}'). Nothing was deleted. Use the Recycle Bin helper instead: ${recycleHelperGuidance}`,
					}
				}
				return undefined
			}

			if (toolName === "write" || toolName === "edit") {
				const path = targetFilePath(input)
				if (path && isMemoryPath(path)) {
					return { block: true, reason: "Direct writes to .serena/memories are blocked. Use Serena's write_memory tool instead." }
				}
				return undefined
			}

			if (toolName === "read") {
				const path = targetFilePath(input)
				if (path && isEnvFile(path)) {
					if (!ctx.hasUI) {
						return { block: true, reason: "Reading .env files requires an interactive approval, unavailable in this mode." }
					}
					try {
						const approved = await ctx.ui.confirm("Read .env file?", `${path} may contain secrets. Allow reading it?`)
						if (!approved) {
							return { block: true, reason: "User declined reading the .env file." }
						}
					} catch (error) {
						console.error("[workflow-guards] .env confirm prompt failed:", error)
						return { block: true, reason: "Reading .env files requires an interactive approval, unavailable in this mode." }
					}
				}
				return undefined
			}

			return undefined
		} catch (error) {
			console.error("[workflow-guards] tool_call guard failed:", error)
			return undefined
		}
	})

	// Guard 4a: stage a critical counter when the prompt asks to remember something
	pi.on("input", async (event) => {
		try {
			const record = (event ?? {}) as Record<string, unknown>
			const text = typeof record.text === "string" ? record.text : ""
			if (text && memoryTrigger.test(text)) {
				ensureState()
				writeFileSync(counterPath, "10", "ascii")
			}
		} catch (error) {
			console.error("[workflow-guards] could not stage critical counter:", error)
		}
		return { action: "continue" as const }
	})

	// Guard 4b: stage memory entries from tool outcomes, mark saves from Serena memory tools
	pi.on("tool_execution_end", async (event) => {
		try {
			const record = (event ?? {}) as Record<string, unknown>
			const toolName = String(record.toolName ?? "")

			const toolCallId = typeof record.toolCallId === "string" ? record.toolCallId : ""
			const input = callInputs.get(toolCallId) ?? ((record.args ?? {}) as Record<string, unknown>)
			callInputs.delete(toolCallId)

			let argText = ""
			try {
				argText = JSON.stringify(input ?? {})
			} catch {
				argText = ""
			}
			const combined = `${toolName} ${argText}`
			if (serenaMemoryTool.test(combined) && serenaMemoryWrite.test(combined)) {
				const entries = readQueue().map((entry) => ({ ...entry, status: "saved" as const }))
				if (entries.length) writeQueue(entries)
				return
			}

			const tool = toolName.toLowerCase()
			if (ignorableTools.has(tool)) return

			const isError = errorResult.test(resultText(record.result))
			const isEdit = editTools.has(tool)
			const command = typeof input.command === "string" ? input.command : ""
			const isImportantCommand = tool === "bash" && importantCommand.test(command)

			let priority: MemoryEntry["priority"] | undefined
			if (isError || isEdit || isImportantCommand) priority = "HIGH"
			if (consumeCriticalCounter() > 0) priority = "CRITICAL"
			if (!priority) return

			let summary = toolName
			if (tool === "bash") summary = `${toolName}: ${command.length > 120 ? `${command.slice(0, 117)}...` : command}`
			else if (isEdit) summary = `${toolName}: ${targetFilePath(input)}`

			appendQueue({
				tool: toolName,
				summary,
				priority,
				timestamp: new Date().toISOString(),
				status: "pending",
				isError,
			})
		} catch (error) {
			console.error("[workflow-guards] memory staging failed:", error)
		}
	})

	// Guard 4c: non-blocking reminder before compaction
	pi.on("session_before_compact", async (event, ctx) => {
		try {
			const pending = pendingEntries()
			if (!pending.length) return
			const list = pending.map((entry) => `- ${entry.summary}`).join("\n")
			ctx.ui.notify(
				`[workflow-guards] Context is about to be compacted. These items have not been saved to Serena:\n${list}\nSave any important context with Serena's write_memory tool. This reminder is non-blocking.`,
				"warning",
			)
		} catch (error) {
			console.error("[workflow-guards] compaction reminder failed:", error)
		}
		return undefined
	})

	// Guard 4d: final reminder on shutdown, then clear state files
	pi.on("session_shutdown", async (event, ctx) => {
		try {
			const pending = pendingEntries()
			if (pending.length && ctx.hasUI) {
				ctx.ui.notify(
					`[workflow-guards] ${pending.length} important item(s) were not saved to Serena. This reminder does not block completion.`,
					"warning",
				)
			}
		} catch (error) {
			console.error("[workflow-guards] shutdown reminder failed:", error)
		}
		clearState()
		callInputs.clear()
	})

	// Guard 5: standing instructions as a persistent session message
	pi.on("before_agent_start", async (event) => {
		return {
			message: {
				customType: "workflow-guards",
				content: `Prefer Serena's symbolic tools for code navigation and edits when they are suitable. Never edit .serena/memories directly; use Serena's memory tools. Permanent deletion commands are blocked. To remove files, use: ${recycleHelperGuidance}.`,
				display: true,
			},
		}
	})
}
