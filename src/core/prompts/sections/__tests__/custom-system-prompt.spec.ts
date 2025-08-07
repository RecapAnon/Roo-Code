// Mocks must come first, before imports

vi.mock("fs/promises")
vi.mock("os")

// Then imports
import type { Mock } from "vitest"
import path from "path"
import os from "os"
import { readFile } from "fs/promises"
import type { Mode } from "../../../../shared/modes" // Type-only import
import { loadSystemPromptFile, PromptVariables, getGlobalSystemPromptFilePath } from "../custom-system-prompt"

// Cast the mocked readFile to the correct Mock type
const mockedReadFile = readFile as Mock<typeof readFile>
const mockedHomedir = os.homedir as Mock<typeof os.homedir>

describe("loadSystemPromptFile", () => {
	// Corrected PromptVariables type and added mockMode
	const mockVariables: PromptVariables = {
		workspace: "/path/to/workspace",
	}
	const mockCwd = "/mock/cwd"
	const mockMode: Mode = "test" // Use Mode type, e.g., 'test'
	const mockHomeDir = "/home/user"
	// Corrected expected file path format
	const expectedLocalFilePath = path.join(mockCwd, ".roo", `system-prompt-${mockMode}`)
	const expectedGlobalFilePath = path.join(mockHomeDir, ".roo", `system-prompt-${mockMode}`)

	beforeEach(() => {
		// Clear mocks before each test
		mockedReadFile.mockClear()
		mockedHomedir.mockReturnValue(mockHomeDir)
	})

	it("should return an empty string if neither local nor global file exists (ENOENT)", async () => {
		const error: NodeJS.ErrnoException = new Error("File not found")
		error.code = "ENOENT"
		mockedReadFile.mockRejectedValue(error)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("")
		expect(mockedReadFile).toHaveBeenCalledTimes(2)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedLocalFilePath, "utf-8")
		expect(mockedReadFile).toHaveBeenCalledWith(expectedGlobalFilePath, "utf-8")
	})

	// Updated test: should re-throw unexpected errors
	it("should re-throw unexpected errors from readFile", async () => {
		const expectedError = new Error("Some other error")
		mockedReadFile.mockRejectedValue(expectedError)

		// Assert that the promise rejects with the specific error
		await expect(loadSystemPromptFile(mockCwd, mockMode, mockVariables)).rejects.toThrow(expectedError)

		// Verify readFile was still called correctly
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedLocalFilePath, "utf-8")
	})

	it("should return an empty string if the local file content is empty and check global", async () => {
		const error: NodeJS.ErrnoException = new Error("File not found")
		error.code = "ENOENT"

		// Local file is empty, global file doesn't exist
		mockedReadFile.mockResolvedValueOnce("").mockRejectedValueOnce(error)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("")
		expect(mockedReadFile).toHaveBeenCalledTimes(2)
		expect(mockedReadFile).toHaveBeenNthCalledWith(1, expectedLocalFilePath, "utf-8")
		expect(mockedReadFile).toHaveBeenNthCalledWith(2, expectedGlobalFilePath, "utf-8")
	})

	// Updated test to only check workspace interpolation
	it("should correctly interpolate workspace variable", async () => {
		const template = "Workspace is: {{workspace}}"
		mockedReadFile.mockResolvedValue(template)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("Workspace is: /path/to/workspace")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedLocalFilePath, "utf-8")
	})

	// Updated test for multiple occurrences of workspace
	it("should handle multiple occurrences of the workspace variable", async () => {
		const template = "Path: {{workspace}}/{{workspace}}"
		mockedReadFile.mockResolvedValue(template)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("Path: /path/to/workspace//path/to/workspace")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedLocalFilePath, "utf-8")
	})

	// Updated test for mixed used/unused
	it("should handle mixed used workspace and unused variables", async () => {
		const template = "Workspace: {{workspace}}, Unused: {{unusedVar}}, Another: {{another}}"
		mockedReadFile.mockResolvedValue(template)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		// Unused variables should remain untouched
		expect(result).toBe("Workspace: /path/to/workspace, Unused: {{unusedVar}}, Another: {{another}}")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedLocalFilePath, "utf-8")
	})

	// Test remains valid, just needs the mode argument and updated template
	it("should handle templates with placeholders not present in variables", async () => {
		const template = "Workspace: {{workspace}}, Missing: {{missingPlaceholder}}"
		mockedReadFile.mockResolvedValue(template)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("Workspace: /path/to/workspace, Missing: {{missingPlaceholder}}")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedLocalFilePath, "utf-8")
	})

	// Removed the test for extra keys as PromptVariables is simple now

	// Test remains valid, just needs the mode argument
	it("should handle template with no variables", async () => {
		const template = "This is a static prompt."
		mockedReadFile.mockResolvedValue(template)

		// Added mockMode argument
		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("This is a static prompt.")
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedLocalFilePath, "utf-8")
	})

	it("should use global system prompt when local file doesn't exist", async () => {
		const error: NodeJS.ErrnoException = new Error("File not found")
		error.code = "ENOENT"
		const globalTemplate = "Global system prompt: {{workspace}}"

		// First call (local) fails, second call (global) succeeds
		mockedReadFile.mockRejectedValueOnce(error).mockResolvedValueOnce(globalTemplate)

		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("Global system prompt: /path/to/workspace")
		expect(mockedReadFile).toHaveBeenCalledTimes(2)
		expect(mockedReadFile).toHaveBeenNthCalledWith(1, expectedLocalFilePath, "utf-8")
		expect(mockedReadFile).toHaveBeenNthCalledWith(2, expectedGlobalFilePath, "utf-8")
	})

	it("should prefer local system prompt over global when both exist", async () => {
		const localTemplate = "Local system prompt: {{workspace}}"
		mockedReadFile.mockResolvedValueOnce(localTemplate)

		const result = await loadSystemPromptFile(mockCwd, mockMode, mockVariables)

		expect(result).toBe("Local system prompt: /path/to/workspace")
		// Should only read the local file, not the global one
		expect(mockedReadFile).toHaveBeenCalledTimes(1)
		expect(mockedReadFile).toHaveBeenCalledWith(expectedLocalFilePath, "utf-8")
	})

	it("should correctly generate global system prompt file path", () => {
		const result = getGlobalSystemPromptFilePath(mockMode)
		expect(result).toBe(expectedGlobalFilePath)
	})
})
