import { describe, test, expect, vi, beforeEach, afterEach } from "vitest"

// Mock vscode workspace
vi.mock("vscode", () => ({
	workspace: {
		workspaceFolders: [
			{
				uri: {
					fsPath: "/test/workspace",
				},
			},
		],
		fs: {
			writeFile: vi.fn().mockResolvedValue(undefined),
			delete: vi.fn().mockResolvedValue(undefined),
		},
	},
	Uri: {
		file: vi.fn((path: string) => ({ fsPath: path })),
	},
}))

// Mock execa to test stdin behavior
const mockExeca = vi.fn()
const mockStdin = {
	write: vi.fn((data, encoding, callback) => {
		// Simulate successful write
		if (callback) callback(null)
	}),
	end: vi.fn(),
}

// Mock process that simulates successful execution
const createMockProcess = () => {
	let resolveProcess: (value: { exitCode: number }) => void
	const processPromise = new Promise<{ exitCode: number }>((resolve) => {
		resolveProcess = resolve
	})

	const mockProcess = {
		stdin: mockStdin,
		stdout: {
			on: vi.fn(),
		},
		stderr: {
			on: vi.fn((event, callback) => {
				// Don't emit any stderr data in tests
			}),
		},
		on: vi.fn((event, callback) => {
			if (event === "close") {
				// Simulate successful process completion after a short delay
				setTimeout(() => {
					callback(0)
					resolveProcess({ exitCode: 0 })
				}, 10)
			}
			if (event === "error") {
				// Don't emit any errors in tests
			}
		}),
		killed: false,
		kill: vi.fn(),
		then: processPromise.then.bind(processPromise),
		catch: processPromise.catch.bind(processPromise),
		finally: processPromise.finally.bind(processPromise),
	}
	return mockProcess
}

vi.mock("execa", () => ({
	execa: mockExeca,
}))

// Mock readline with proper interface simulation
let mockReadlineInterface: any = null

vi.mock("readline", () => ({
	default: {
		createInterface: vi.fn(() => {
			mockReadlineInterface = {
				async *[Symbol.asyncIterator]() {
					// Simulate Claude CLI JSON output
					yield '{"type":"text","text":"Hello"}'
					yield '{"type":"text","text":" world"}'
					// Simulate end of stream - must return to terminate the iterator
					return
				},
				close: vi.fn(),
			}
			return mockReadlineInterface
		}),
	},
}))

// Mock path and os modules
vi.mock("path", () => ({
	join: vi.fn((...args: string[]) => args.join("/")),
}))

vi.mock("os", () => ({
	tmpdir: vi.fn(() => "/tmp"),
}))

describe("runClaudeCode", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		mockExeca.mockReturnValue(createMockProcess())
		// Mock setImmediate to run synchronously in tests
		vi.spyOn(global, "setImmediate").mockImplementation((callback: any) => {
			callback()
			return {} as any
		})
	})

	afterEach(() => {
		vi.restoreAllMocks()
	})

	test("should export runClaudeCode function", async () => {
		const { runClaudeCode } = await import("../run")
		expect(typeof runClaudeCode).toBe("function")
	})

	test("should be an async generator function", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const result = runClaudeCode(options)
		expect(Symbol.asyncIterator in result).toBe(true)
		expect(typeof result[Symbol.asyncIterator]).toBe("function")
	})

	test("should use stdin instead of command line arguments for messages", async () => {
		const { runClaudeCode } = await import("../run")
		const messages = [{ role: "user" as const, content: "Hello world!" }]
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages,
		}

		const generator = runClaudeCode(options)

		// Consume the generator to completion
		const results = []
		for await (const chunk of generator) {
			results.push(chunk)
		}

		// Verify execa was called with correct arguments (no JSON.stringify(messages) in args)
		expect(mockExeca).toHaveBeenCalledWith(
			"claude",
			expect.arrayContaining([
				"-p",
				"--system-prompt",
				"You are a helpful assistant",
				"--verbose",
				"--output-format",
				"stream-json",
				"--disallowedTools",
				expect.any(String),
				"--max-turns",
				"1",
			]),
			expect.objectContaining({
				stdin: "pipe",
				stdout: "pipe",
				stderr: "pipe",
			}),
		)

		// Verify the arguments do NOT contain the stringified messages
		const [, args] = mockExeca.mock.calls[0]
		expect(args).not.toContain(JSON.stringify(messages))

		// Verify messages were written to stdin with callback
		expect(mockStdin.write).toHaveBeenCalledWith(JSON.stringify(messages), "utf8", expect.any(Function))
		expect(mockStdin.end).toHaveBeenCalled()

		// Verify we got the expected mock output
		expect(results).toHaveLength(2)
		expect(results[0]).toEqual({ type: "text", text: "Hello" })
		expect(results[1]).toEqual({ type: "text", text: " world" })
	})

	test("should include model parameter when provided", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
			modelId: "claude-3-5-sonnet-20241022",
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		const [, args] = mockExeca.mock.calls[0]
		expect(args).toContain("--model")
		expect(args).toContain("claude-3-5-sonnet-20241022")
	})

	test("should use custom claude path when provided", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
			path: "/custom/path/to/claude",
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		const [claudePath] = mockExeca.mock.calls[0]
		expect(claudePath).toBe("/custom/path/to/claude")
	})

	test("should handle stdin write errors gracefully", async () => {
		const { runClaudeCode } = await import("../run")

		// Create a mock process with stdin that fails
		const mockProcessWithError = createMockProcess()
		mockProcessWithError.stdin.write = vi.fn((data, encoding, callback) => {
			// Simulate write error
			if (callback) callback(new Error("EPIPE: broken pipe"))
		})

		// Mock console.error to verify error logging
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		mockExeca.mockReturnValueOnce(mockProcessWithError)

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Try to consume the generator
		try {
			await generator.next()
		} catch (error) {
			// Expected to fail
		}

		// Verify error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error writing to Claude Code stdin:", expect.any(Error))

		// Verify process was killed
		expect(mockProcessWithError.kill).toHaveBeenCalled()

		// Clean up
		consoleErrorSpy.mockRestore()
		await generator.return(undefined)
	})

	test("should handle stdin access errors gracefully", async () => {
		const { runClaudeCode } = await import("../run")

		// Create a mock process without stdin
		const mockProcessWithoutStdin = createMockProcess()
		mockProcessWithoutStdin.stdin = null as any

		// Mock console.error to verify error logging
		const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {})

		mockExeca.mockReturnValueOnce(mockProcessWithoutStdin)

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Try to consume the generator
		try {
			await generator.next()
		} catch (error) {
			// Expected to fail
		}

		// Verify error was logged
		expect(consoleErrorSpy).toHaveBeenCalledWith("Error accessing Claude Code stdin:", expect.any(Error))

		// Verify process was killed
		expect(mockProcessWithoutStdin.kill).toHaveBeenCalled()

		// Clean up
		consoleErrorSpy.mockRestore()
		await generator.return(undefined)
	})

	test("should use command line argument for short system prompts", async () => {
		const { runClaudeCode } = await import("../run")
		const shortSystemPrompt = "You are a helpful assistant"
		const options = {
			systemPrompt: shortSystemPrompt,
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		// Verify execa was called with system prompt as command line argument
		const [, args, execaOptions] = mockExeca.mock.calls[0]
		expect(args).toContain("--system-prompt")
		expect(args).toContain(shortSystemPrompt)

		// Verify no environment variable was set for short prompt
		expect(execaOptions.env?.CLAUDE_CODE_SYSTEM_PROMPT).toBeUndefined()
	})

	test("should use temporary file for long system prompts to avoid Windows ENAMETOOLONG error", async () => {
		const { runClaudeCode } = await import("../run")
		// Create a system prompt longer than MAX_COMMAND_LINE_LENGTH (7000 chars)
		const longSystemPrompt = "You are a helpful assistant. " + "A".repeat(7000)
		const options = {
			systemPrompt: longSystemPrompt,
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		// Verify execa was called with --system-prompt @filepath pattern
		const [, args, execaOptions] = mockExeca.mock.calls[0]
		expect(args).toContain("--system-prompt")

		// Find the system prompt argument
		const systemPromptIndex = args.indexOf("--system-prompt")
		expect(systemPromptIndex).toBeGreaterThan(-1)
		const systemPromptArg = args[systemPromptIndex + 1]

		// Verify it uses the @filepath pattern for temp files
		expect(systemPromptArg).toMatch(/^@.*claude-system-prompt-.*\.txt$/)

		// Verify the long system prompt is not directly in the arguments
		expect(args).not.toContain(longSystemPrompt)

		// Verify no environment variable was set for system prompt
		expect(execaOptions.env?.CLAUDE_CODE_SYSTEM_PROMPT).toBeUndefined()
	})

	test("should handle exactly MAX_COMMAND_LINE_LENGTH system prompt using command line", async () => {
		const { runClaudeCode } = await import("../run")
		// Create a system prompt exactly at the threshold (7000 chars)
		const exactLengthPrompt = "A".repeat(7000)
		const options = {
			systemPrompt: exactLengthPrompt,
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		// Verify execa was called with system prompt as command line argument (at threshold)
		const [, args, execaOptions] = mockExeca.mock.calls[0]
		expect(args).toContain("--system-prompt")
		expect(args).toContain(exactLengthPrompt)

		// Verify no temporary file was used (no @ prefix)
		const systemPromptIndex = args.indexOf("--system-prompt")
		const systemPromptArg = args[systemPromptIndex + 1]
		expect(systemPromptArg).not.toMatch(/^@/)
	})

	test("should handle system prompt one character over threshold using temporary file", async () => {
		const { runClaudeCode } = await import("../run")
		// Create a system prompt one character over the threshold (7001 chars)
		const overThresholdPrompt = "A".repeat(7001)
		const options = {
			systemPrompt: overThresholdPrompt,
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		// Verify execa was called with --system-prompt @filepath pattern
		const [, args, execaOptions] = mockExeca.mock.calls[0]
		expect(args).toContain("--system-prompt")

		// Find the system prompt argument
		const systemPromptIndex = args.indexOf("--system-prompt")
		const systemPromptArg = args[systemPromptIndex + 1]

		// Verify it uses the @filepath pattern for temp files
		expect(systemPromptArg).toMatch(/^@.*claude-system-prompt-.*\.txt$/)

		// Verify the long system prompt is not directly in the arguments
		expect(args).not.toContain(overThresholdPrompt)

		// Verify no environment variable was set
		expect(execaOptions.env?.CLAUDE_CODE_SYSTEM_PROMPT).toBeUndefined()
	})

	test("should preserve existing environment variables when using temporary files", async () => {
		const { runClaudeCode } = await import("../run")

		// Mock process.env to have some existing variables
		const originalEnv = process.env
		process.env = {
			...originalEnv,
			EXISTING_VAR: "existing_value",
			PATH: "/usr/bin:/bin",
		}

		const longSystemPrompt = "You are a helpful assistant. " + "A".repeat(7000)
		const options = {
			systemPrompt: longSystemPrompt,
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		// Verify environment variables include existing ones but no CLAUDE_CODE_SYSTEM_PROMPT
		const [, , execaOptions] = mockExeca.mock.calls[0]
		expect(execaOptions.env).toEqual({
			...process.env,
			CLAUDE_CODE_MAX_OUTPUT_TOKENS: expect.any(String), // Always set by the implementation
		})

		// Verify no system prompt environment variable was set
		expect(execaOptions.env?.CLAUDE_CODE_SYSTEM_PROMPT).toBeUndefined()

		// Restore original environment
		process.env = originalEnv
	})

	test("should work with empty system prompt", async () => {
		const { runClaudeCode } = await import("../run")
		const options = {
			systemPrompt: "",
			messages: [{ role: "user" as const, content: "Hello" }],
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		// Verify execa was called with empty system prompt as command line argument
		const [, args, execaOptions] = mockExeca.mock.calls[0]
		expect(args).toContain("--system-prompt")
		expect(args).toContain("")

		// Verify no temporary file was used (no @ prefix)
		const systemPromptIndex = args.indexOf("--system-prompt")
		const systemPromptArg = args[systemPromptIndex + 1]
		expect(systemPromptArg).not.toMatch(/^@/)
	})

	test("should use cmd.exe wrapper on Windows for command execution", async () => {
		const { runClaudeCode } = await import("../run")
		
		// Mock process.platform to simulate Windows
		const originalPlatform = process.platform
		Object.defineProperty(process, "platform", {
			value: "win32",
		})

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
			path: "claude",
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		// Verify execa was called with cmd.exe wrapper on Windows
		const [command, args] = mockExeca.mock.calls[0]
		expect(command).toBe("cmd.exe")
		expect(args).toEqual(expect.arrayContaining(["/c", "claude"]))
		expect(args).toContain("-p")

		// Restore original platform
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
		})
	})

	test("should not double-wrap cmd.exe on Windows", async () => {
		const { runClaudeCode } = await import("../run")
		
		// Mock process.platform to simulate Windows
		const originalPlatform = process.platform
		Object.defineProperty(process, "platform", {
			value: "win32",
		})

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
			path: "cmd.exe", // Already cmd.exe
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		// Verify execa was called without double-wrapping
		const [command, args] = mockExeca.mock.calls[0]
		expect(command).toBe("cmd.exe")
		expect(args).not.toContain("/c") // Should not have /c since it's already cmd.exe

		// Restore original platform
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
		})
	})

	test("should not use cmd.exe wrapper on non-Windows platforms", async () => {
		const { runClaudeCode } = await import("../run")
		
		// Mock process.platform to simulate Linux/macOS
		const originalPlatform = process.platform
		Object.defineProperty(process, "platform", {
			value: "linux",
		})

		const options = {
			systemPrompt: "You are a helpful assistant",
			messages: [{ role: "user" as const, content: "Hello" }],
			path: "claude",
		}

		const generator = runClaudeCode(options)

		// Consume at least one item to trigger process spawn
		await generator.next()

		// Clean up the generator
		await generator.return(undefined)

		// Verify execa was called directly without cmd.exe wrapper
		const [command, args] = mockExeca.mock.calls[0]
		expect(command).toBe("claude")
		expect(args).not.toContain("/c")
		expect(args).toContain("-p")

		// Restore original platform
		Object.defineProperty(process, "platform", {
			value: originalPlatform,
		})
	})
})
