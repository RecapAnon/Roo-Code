import { ToolArgs } from "./types"

export function getAttemptCompletionDescription(args?: ToolArgs): string {
	return `## attempt_completion
Description: After each tool use, the user will respond with the result of that tool use, i.e. if it succeeded or failed, along with any reasons for failure. Once you've received the results of tool uses and can confirm that the task is complete, use this tool to present the result of your work to the user. The user may respond with feedback if they are not satisfied with the result, which you can use to make improvements and try again.
IMPORTANT NOTE: This tool CANNOT be used until you've confirmed from the user that any previous tool uses were successful. Failure to do so will result in code corruption and system failure. Before using this tool, you must confirm that you've received successful results from the user for any previous tool uses. If not, then DO NOT use this tool.
Parameters:
- result: (required) The result of the task. Formulate this result in a way that is final and does not require further input from the user. Don't end your result with questions or offers for further assistance.
Usage:
<function_calls>
<invoke name="attempt_completion">
<parameter name="result">
Your final result description here
</parameter>
</invoke>
</function_calls>

Example: Requesting to attempt completion with a result
<function_calls>
<invoke name="attempt_completion">
<parameter name="result">
I've updated the CSS
</parameter>
</invoke>
</function_calls>`
}
