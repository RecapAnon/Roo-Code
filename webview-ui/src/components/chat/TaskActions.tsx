import { useState } from "react"
import prettyBytes from "pretty-bytes"
import { useTranslation } from "react-i18next"

import type { HistoryItem } from "@roo-code/types"

import { vscode } from "@/utils/vscode"
import { useCopyToClipboard } from "@/utils/clipboard"

import { DeleteTaskDialog } from "../history/DeleteTaskDialog"
import { IconButton } from "./IconButton"
import { ShareButton } from "./ShareButton"
import HierarchicalMemoryModal from "./HierarchicalMemoryModal"

interface TaskActionsProps {
	item?: HistoryItem
	buttonsDisabled: boolean
	hierarchicalMemories?: Array<{ path: string; content: string }>
}

export const TaskActions = ({ item, buttonsDisabled, hierarchicalMemories }: TaskActionsProps) => {
	const [deleteTaskId, setDeleteTaskId] = useState<string | null>(null)
	const [showMemoryModal, setShowMemoryModal] = useState(false)
	const { t } = useTranslation()
	const { copyWithFeedback, showCopyFeedback } = useCopyToClipboard()

	return (
		<>
			<div className="flex flex-row gap-1">
				<ShareButton item={item} disabled={false} />
				{hierarchicalMemories && hierarchicalMemories.length > 0 && (
					<IconButton
						iconClass="codicon-library"
						title={t("chat:hierarchicalMemory.viewMemory")}
						onClick={() => setShowMemoryModal(true)}
					/>
				)}
				<IconButton
					iconClass="codicon-desktop-download"
					title={t("chat:task.export")}
					onClick={() => vscode.postMessage({ type: "exportCurrentTask" })}
				/>
				{item?.task && (
					<IconButton
						iconClass={showCopyFeedback ? "codicon-check" : "codicon-copy"}
						title={t("history:copyPrompt")}
						onClick={(e) => copyWithFeedback(item.task, e)}
					/>
				)}
				{!!item?.size && item.size > 0 && (
					<>
						<div className="flex items-center">
							<IconButton
								iconClass="codicon-trash"
								title={t("chat:task.delete")}
								disabled={buttonsDisabled}
								onClick={(e) => {
									e.stopPropagation()

									if (e.shiftKey) {
										vscode.postMessage({ type: "deleteTaskWithId", text: item.id })
									} else {
										setDeleteTaskId(item.id)
									}
								}}
							/>
							<span className="ml-1 text-xs text-vscode-foreground opacity-85">
								{prettyBytes(item.size)}
							</span>
						</div>
						{deleteTaskId && (
							<DeleteTaskDialog
								taskId={deleteTaskId}
								onOpenChange={(open) => !open && setDeleteTaskId(null)}
								open
							/>
						)}
					</>
				)}
			</div>
			{hierarchicalMemories && (
				<HierarchicalMemoryModal
					isOpen={showMemoryModal}
					onClose={() => setShowMemoryModal(false)}
					memories={hierarchicalMemories}
				/>
			)}
		</>
	)
}
