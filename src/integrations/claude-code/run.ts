import * as vscode from "vscode"
import type Anthropic from "@anthropic-ai/sdk"
import { execa } from "execa"
import { ClaudeCodeMessage } from "./types"
import readline from "readline"
import { CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS } from "@roo-code/types"
import * as path from "path"
import * as os from "os"

const cwd = vscode.workspace.workspaceFolders?.map((folder) => folder.uri.fsPath).at(0)

type ClaudeCodeOptions = {
	systemPrompt: string
	messages: Anthropic.Messages.MessageParam[]
	path?: string
	modelId?: string
}

type ProcessState = {
	partialData: string | null
	error: Error | null
	stderrLogs: string
	exitCode: number | null
}

type TempFileCleanup = {
	filePath: string
	cleanup: () => Promise<void>
}

export async function* runClaudeCode(
	options: ClaudeCodeOptions & { maxOutputTokens?: number },
): AsyncGenerator<ClaudeCodeMessage | string> {
	const { process, tempFileCleanup } = await runProcess(options)

	const rl = readline.createInterface({
		input: process.stdout!,
	})

	try {
		const processState: ProcessState = {
			error: null,
			stderrLogs: "",
			exitCode: null,
			partialData: null,
		}

		process.stderr?.on("data", (data) => {
			processState.stderrLogs += data.toString()
		})

		process.on("close", (code) => {
			processState.exitCode = code
		})

		process.on("error", (err) => {
			processState.error = err
		})

		for await (const line of rl) {
			if (processState.error) {
				throw processState.error
			}

			if (line.trim()) {
				const chunk = parseChunk(line, processState)

				if (!chunk) {
					continue
				}

				yield chunk
			}
		}

		// We rely on the assistant message. If the output was truncated, it's better having a poorly formatted message
		// from which to extract something, than throwing an error/showing the model didn't return any messages.
		if (processState.partialData && processState.partialData.startsWith(`{"type":"assistant"`)) {
			yield processState.partialData
		}

		const { exitCode } = await process
		if (exitCode !== null && exitCode !== 0) {
			const errorOutput = processState.error?.message || processState.stderrLogs?.trim()
			
			// Provide more specific error messages for common Windows issues
			let errorMessage = `Claude Code process exited with code ${exitCode}`
			
			if (errorOutput) {
				// Check for common Windows-specific errors
				if (errorOutput.includes("ENAMETOOLONG") || errorOutput.includes("command line too long")) {
					errorMessage += ". This appears to be a Windows command line length issue. Try using a shorter system prompt or ensure the Claude CLI is properly installed."
				} else if (errorOutput.includes("is not recognized as an internal or external command")) {
					errorMessage += ". The 'claude' command was not found. Please ensure the Claude CLI is installed and available in your PATH."
				} else if (errorOutput.includes("Access is denied") || errorOutput.includes("EACCES")) {
					errorMessage += ". Access denied. Please check file permissions and ensure the Claude CLI has proper execution rights."
				} else {
					errorMessage += `. Error output: ${errorOutput}`
				}
			}
			
			throw new Error(errorMessage)
		}
	} finally {
		rl.close()
		if (!process.killed) {
			process.kill()
		}
		// Clean up temporary file if it was created
		if (tempFileCleanup) {
			await tempFileCleanup.cleanup()
		}
	}
}

// We want the model to use our custom tool format instead of built-in tools.
// Disabling built-in tools prevents tool-only responses and ensures text output.
const claudeCodeTools = [
	"Task",
	"Bash",
	"Glob",
	"Grep",
	"LS",
	"exit_plan_mode",
	"Read",
	"Edit",
	"MultiEdit",
	"Write",
	"NotebookRead",
	"NotebookEdit",
	"WebFetch",
	"TodoRead",
	"TodoWrite",
	"WebSearch",
].join(",")

const CLAUDE_CODE_TIMEOUT = 600000 // 10 minutes

// Windows has a command line length limit of ~8191 characters
// If the system prompt is too long, we'll write it to a temporary file instead
const MAX_COMMAND_LINE_LENGTH = 7000 // Conservative limit to account for other arguments

async function runProcess({
	systemPrompt,
	messages,
	path: claudeCodePath,
	modelId,
	maxOutputTokens,
}: ClaudeCodeOptions & { maxOutputTokens?: number }): Promise<{
	process: ReturnType<typeof execa>
	tempFileCleanup: TempFileCleanup | null
}> {
	const claudePath = claudeCodePath || "claude"

	// Check if system prompt is too long for command line
	const useTempFileForSystemPrompt = systemPrompt.length > MAX_COMMAND_LINE_LENGTH

	const baseArgs = ["-p"]
	let tempFileCleanup: TempFileCleanup | null = null

	// Handle system prompt - use temp file for long prompts, command line for short ones
	if (useTempFileForSystemPrompt) {
		// Create temporary file for system prompt
		const tempFilePath = path.join(
			os.tmpdir(),
			`claude-system-prompt-${Date.now()}-${Math.random().toString(36).substring(2)}.txt`,
		)

		try {
			await vscode.workspace.fs.writeFile(vscode.Uri.file(tempFilePath), Buffer.from(systemPrompt, "utf8"))
			baseArgs.push("--system-prompt", `@${tempFilePath}`)

			tempFileCleanup = {
				filePath: tempFilePath,
				cleanup: async () => {
					try {
						await vscode.workspace.fs.delete(vscode.Uri.file(tempFilePath))
					} catch (error) {
						// Ignore cleanup errors - temp files will be cleaned up by OS eventually
						console.warn(`Failed to clean up temporary system prompt file ${tempFilePath}:`, error)
					}
				},
			}
		} catch (error) {
			throw new Error(`Failed to create temporary file for system prompt: ${error}`)
		}
	} else {
		// Use command line argument for short system prompts
		baseArgs.push("--system-prompt", systemPrompt)
	}

	baseArgs.push(
		"--verbose",
		"--output-format",
		"stream-json",
		"--disallowedTools",
		claudeCodeTools,
		// Roo Code will handle recursive calls
		"--max-turns",
		"1",
	)

	if (modelId) {
		baseArgs.push("--model", modelId)
	}

	// On Windows, wrap commands with cmd.exe to handle non-exe executables like npx.ps1
	// This is necessary for node version managers (fnm, nvm-windows, volta) that implement
	// commands as PowerShell scripts rather than executables.
	// This pattern is used in McpHub.ts for MCP servers and resolves Windows execution issues.
	const isWindows = process.platform === "win32"
	
	// Check if command is already cmd.exe to avoid double-wrapping
	const isAlreadyWrapped = claudePath.toLowerCase() === "cmd.exe" || claudePath.toLowerCase() === "cmd"
	
	const command = isWindows && !isAlreadyWrapped ? "cmd.exe" : claudePath
	const args = isWindows && !isAlreadyWrapped ? ["/c", claudePath, ...baseArgs] : baseArgs

	const env: Record<string, string> = {
		...process.env,
		// Use the configured value, or the environment variable, or default to CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS
		CLAUDE_CODE_MAX_OUTPUT_TOKENS:
			maxOutputTokens?.toString() ||
			process.env.CLAUDE_CODE_MAX_OUTPUT_TOKENS ||
			CLAUDE_CODE_DEFAULT_MAX_OUTPUT_TOKENS.toString(),
	}

	const child = execa(command, args, {
		stdin: "pipe",
		stdout: "pipe",
		stderr: "pipe",
		env,
		cwd,
		maxBuffer: 1024 * 1024 * 1000,
		timeout: CLAUDE_CODE_TIMEOUT,
	})

	// Write messages to stdin after process is spawned
	// This avoids the E2BIG error on Linux and ENAMETOOLONG error on Windows when passing large data as command line arguments
	// Linux has a per-argument limit of ~128KiB for execve() system calls
	// Windows has a total command line length limit of ~8191 characters
	// For system prompts, we use temporary files when they exceed the safe limit
	const messagesJson = JSON.stringify(messages)

	// Use setImmediate to ensure the process has been spawned before writing to stdin
	// This prevents potential race conditions where stdin might not be ready
	setImmediate(() => {
		try {
			child.stdin.write(messagesJson, "utf8", (error) => {
				if (error) {
					console.error("Error writing to Claude Code stdin:", error)
					child.kill()
				}
			})
			child.stdin.end()
		} catch (error) {
			console.error("Error accessing Claude Code stdin:", error)
			child.kill()
		}
	})

	return { process: child, tempFileCleanup }
}

function parseChunk(data: string, processState: ProcessState) {
	if (processState.partialData) {
		processState.partialData += data

		const chunk = attemptParseChunk(processState.partialData)

		if (!chunk) {
			return null
		}

		processState.partialData = null
		return chunk
	}

	const chunk = attemptParseChunk(data)

	if (!chunk) {
		processState.partialData = data
	}

	return chunk
}

function attemptParseChunk(data: string): ClaudeCodeMessage | null {
	try {
		// Trim whitespace and ensure we have valid JSON
		const trimmedData = data.trim()
		if (!trimmedData) {
			return null
		}

		// Check if the data looks like JSON (starts with { and ends with })
		if (!trimmedData.startsWith("{") || !trimmedData.endsWith("}")) {
			console.warn("Received non-JSON data from Claude Code:", trimmedData.substring(0, 100))
			return null
		}

		const parsed = JSON.parse(trimmedData)
		
		// Validate that the parsed object has the expected structure
		if (!parsed || typeof parsed !== "object" || !parsed.type) {
			console.warn("Parsed data missing required 'type' field:", parsed)
			return null
		}

		return parsed as ClaudeCodeMessage
	} catch (error) {
		// Log more detailed error information for debugging
		console.error("Error parsing chunk from Claude Code:", {
			error: error instanceof Error ? error.message : String(error),
			dataLength: data.length,
			dataPreview: data.substring(0, 200),
			dataEnding: data.length > 200 ? data.substring(data.length - 50) : "",
		})
		return null
	}
}
