import * as fs from "fs/promises"
import * as path from "path"

/**
 * Creates a comprehensive task message for rules generation that can be used with initClineWithTask
 */
export async function createRulesGenerationTaskMessage(
	workspacePath: string,
	selectedRuleTypes: string[],
	addToGitignore: boolean,
	alwaysAllowWriteProtected: boolean = false,
	includeCustomRules: boolean = false,
	customRulesText: string = "",
): Promise<string> {
	// Only create directories if auto-approve is enabled
	if (alwaysAllowWriteProtected) {
		const directoriesToCreate = [
			path.join(workspacePath, ".roo", "rules"),
			path.join(workspacePath, ".roo", "rules-code"),
			path.join(workspacePath, ".roo", "rules-architect"),
			path.join(workspacePath, ".roo", "rules-debug"),
			path.join(workspacePath, ".roo", "rules-docs-extractor"),
		]

		for (const dir of directoriesToCreate) {
			try {
				await fs.mkdir(dir, { recursive: true })
			} catch (error) {
				// Directory might already exist, which is fine
			}
		}
	}

	// Create rule-specific instructions based on selected types
	interface RuleInstruction {
		path: string
		focus: string
		analysisSteps: string[]
	}

	const ruleInstructions: RuleInstruction[] = selectedRuleTypes
		.map((type) => {
			switch (type) {
				case "general":
					return {
						path: ".roo/rules/coding-standards.md",
						focus: "General coding standards that apply to all modes, including naming conventions, file organization, and general best practices",
						analysisSteps: [
							"Examine the project structure and file organization patterns",
							"Identify naming conventions for files, functions, variables, and classes",
							"Look for general coding patterns and conventions used throughout the codebase",
							"Check for any existing documentation or README files that describe project standards",
						],
					}
				case "code":
					return {
						path: ".roo/rules-code/implementation-rules.md",
						focus: "Specific rules for code implementation, focusing on syntax patterns, code structure, error handling, testing approaches, and detailed implementation guidelines",
						analysisSteps: [
							"Analyze package.json or equivalent files to identify dependencies and build tools",
							"Check for linting and formatting tools (ESLint, Prettier, etc.) and their configurations",
							"Examine test files to understand testing patterns and frameworks used",
							"Look for error handling patterns and logging strategies",
							"Identify code style preferences and import/export patterns",
							"Check for TypeScript usage and type definition patterns if applicable",
						],
					}
				case "architect":
					return {
						path: ".roo/rules-architect/architecture-rules.md",
						focus: "High-level system design rules, focusing on file layout, module organization, architectural patterns, and system-wide design principles",
						analysisSteps: [
							"Analyze the overall directory structure and module organization",
							"Identify architectural patterns (MVC, microservices, monorepo, etc.)",
							"Look for separation of concerns and layering patterns",
							"Check for API design patterns and service boundaries",
							"Examine how different parts of the system communicate",
						],
					}
				case "debug":
					return {
						path: ".roo/rules-debug/debugging-rules.md",
						focus: "Debugging workflow rules, including error investigation approaches, logging strategies, troubleshooting patterns, and debugging best practices",
						analysisSteps: [
							"Identify logging frameworks and patterns used in the codebase",
							"Look for error handling and exception patterns",
							"Check for debugging tools or scripts in the project",
							"Analyze test structure for debugging approaches",
							"Look for monitoring or observability patterns",
						],
					}
				case "docs-extractor":
					return {
						path: ".roo/rules-docs-extractor/documentation-rules.md",
						focus: "Documentation extraction and formatting rules, including documentation style guides, API documentation patterns, and content organization",
						analysisSteps: [
							"Check for existing documentation files and their formats",
							"Analyze code comments and documentation patterns",
							"Look for API documentation tools or generators",
							"Identify documentation structure and organization patterns",
							"Check for examples or tutorials in the codebase",
						],
					}
				default:
					return null
			}
		})
		.filter((rule): rule is RuleInstruction => rule !== null)

	// Create a comprehensive message for the rules generation task
	const taskMessage = `Analyze this codebase and generate comprehensive rules for AI agents working in this repository.

Your task is to:

1. **Analyze the project structure** by:
${ruleInstructions.map((rule) => `   - For ${rule.path.split("/").pop()}: ${rule.analysisSteps.join("; ")}`).join("\n")}

2. **Look for existing rule files** that might provide guidance:
   - Check for CLAUDE.md, .cursorrules, .cursor/rules, or .github/copilot-instructions.md
   - If found, incorporate and improve upon their content

3. **Generate and save the following rule files**:
${ruleInstructions
	.map(
		(rule, index) => `
   ${index + 1}. **${rule.path}**
      - Focus: ${rule.focus}${alwaysAllowWriteProtected ? "\n      - The directory has already been created for you" : "\n      - Create the necessary directories if they don't exist"}
      - Always overwrite the existing file if it exists
      - Use the \`write_to_file\` tool to save the content${alwaysAllowWriteProtected ? "\n      - Note: Auto-approval for protected file writes is enabled, so you can write to .roo directories without manual approval" : "\n      - Note: You will need to approve the creation of protected directories and files"}`,
	)
	.join("\n")}

4. **Make the rules actionable and specific** by including:
   - Build/lint/test commands (especially for running single tests)
   - Code style guidelines including imports, formatting, types, naming conventions
   - Error handling patterns specific to this project
   - Project-specific conventions and best practices
   - File organization patterns

5. **Keep rules concise** - aim for 20 lines per file, focusing on the most important guidelines

6. **Open the generated files** in the editor for review after creation

Use the \`safeWriteJson\` utility from \`src/utils/safeWriteJson.ts\` for any JSON file operations to ensure atomic writes.

${
	addToGitignore
		? `7. **Add the generated files to .gitignore**:
   - After generating all rule files, add entries to .gitignore to prevent them from being committed
   - Add each generated file path to .gitignore (e.g., .roo/rules/coding-standards.md)
   - If .gitignore doesn't exist, create it
   - If the entries already exist in .gitignore, don't duplicate them`
		: ""
}

${
	includeCustomRules && customRulesText
		? `\n**Additional rules from User to add to the rules file:**\n${customRulesText}`
		: ""
}`

	return taskMessage
}
