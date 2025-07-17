import { HTMLAttributes, useState, useEffect } from "react"
import { useAppTranslation } from "@/i18n/TranslationContext"
import { FileText, Loader2, AlertTriangle, Info } from "lucide-react"
import { Button } from "@/components/ui/button"
import { vscode } from "@/utils/vscode"
import { cn } from "@/lib/utils"
import { useExtensionState } from "@/context/ExtensionStateContext"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui"

import { SectionHeader } from "./SectionHeader"
import { Section } from "./Section"

type RulesSettingsProps = HTMLAttributes<HTMLDivElement>

interface RuleType {
	id: string
	label: string
	description: string
	checked: boolean
	exists?: boolean
}

export const RulesSettings = ({ className, ...props }: RulesSettingsProps) => {
	const { t } = useAppTranslation()
	const [isGenerating, setIsGenerating] = useState(false)
	const [generationStatus, setGenerationStatus] = useState<{
		type: "success" | "error" | null
		message: string
	}>({ type: null, message: "" })
	const [addToGitignore, setAddToGitignore] = useState(false)
	const [_existingFiles, setExistingFiles] = useState<string[]>([])
	const [alwaysAllowWriteProtected, setAlwaysAllowWriteProtected] = useState(false)
	const [selectedApiConfig, setSelectedApiConfig] = useState<string>("")

	const { listApiConfigMeta, currentApiConfigName } = useExtensionState()

	const [ruleTypes, setRuleTypes] = useState<RuleType[]>([
		{
			id: "general",
			label: t("settings:rules.types.general.label"),
			description: t("settings:rules.types.general.description"),
			checked: true,
			exists: false,
		},
		{
			id: "code",
			label: t("settings:rules.types.code.label"),
			description: t("settings:rules.types.code.description"),
			checked: true,
			exists: false,
		},
		{
			id: "architect",
			label: t("settings:rules.types.architect.label"),
			description: t("settings:rules.types.architect.description"),
			checked: true,
			exists: false,
		},
		{
			id: "debug",
			label: t("settings:rules.types.debug.label"),
			description: t("settings:rules.types.debug.description"),
			checked: true,
			exists: false,
		},
		{
			id: "docs-extractor",
			label: t("settings:rules.types.docsExtractor.label"),
			description: t("settings:rules.types.docsExtractor.description"),
			checked: true,
			exists: false,
		},
	])

	const handleRuleTypeToggle = (id: string) => {
		setRuleTypes((prev) => prev.map((rule) => (rule.id === id ? { ...rule, checked: !rule.checked } : rule)))
	}

	// Check for existing files and get current settings when component mounts
	useEffect(() => {
		vscode.postMessage({
			type: "checkExistingRuleFiles",
		})

		// Request current state to get alwaysAllowWriteProtected value
		vscode.postMessage({ type: "webviewDidLaunch" })

		// Set default API config
		if (currentApiConfigName && !selectedApiConfig) {
			setSelectedApiConfig(currentApiConfigName)
		}
	}, [currentApiConfigName, selectedApiConfig])

	useEffect(() => {
		const handleMessage = (event: MessageEvent) => {
			const message = event.data
			if (message.type === "rulesGenerationStatus") {
				setIsGenerating(false)
				if (message.success) {
					setGenerationStatus({
						type: "success",
						message: message.text || "",
					})
				} else {
					setGenerationStatus({
						type: "error",
						message: message.error || "Unknown error occurred",
					})
				}
			} else if (message.type === "existingRuleFiles") {
				setExistingFiles(message.files || [])
				// Update rule types with existence information
				setRuleTypes((prev) =>
					prev.map((rule) => ({
						...rule,
						exists: message.files?.includes(rule.id) || false,
					})),
				)
			} else if (message.type === "state") {
				// Update alwaysAllowWriteProtected from the extension state
				if (message.state?.alwaysAllowWriteProtected !== undefined) {
					setAlwaysAllowWriteProtected(message.state.alwaysAllowWriteProtected)
				}
			}
		}

		window.addEventListener("message", handleMessage)
		return () => window.removeEventListener("message", handleMessage)
	}, [])

	const handleGenerateRules = () => {
		const selectedRules = ruleTypes.filter((rule) => rule.checked)
		if (selectedRules.length === 0) {
			setGenerationStatus({
				type: "error",
				message: t("settings:rules.noRulesSelected"),
			})
			return
		}

		setIsGenerating(true)
		setGenerationStatus({ type: null, message: "" })

		// Send message to extension to generate rules
		vscode.postMessage({
			type: "generateRules",
			selectedRuleTypes: selectedRules.map((rule) => rule.id),
			addToGitignore,
			alwaysAllowWriteProtected,
			apiConfigName: selectedApiConfig,
		})
	}

	const existingRules = ruleTypes.filter((rule) => rule.checked && rule.exists)
	const hasExistingFiles = existingRules.length > 0

	return (
		<div className={cn("flex flex-col gap-2", className)} {...props}>
			<SectionHeader>
				<div className="flex items-center gap-2">
					<FileText className="w-4" />
					<div>{t("settings:rules.title")}</div>
				</div>
			</SectionHeader>

			<Section>
				<div className="space-y-4">
					<p className="text-vscode-descriptionForeground text-sm">{t("settings:rules.description")}</p>

					{/* Recommendation box */}
					<div className="flex items-start gap-2 p-3 bg-vscode-inputValidation-infoBackground border border-vscode-inputValidation-infoBorder rounded-md">
						<Info className="w-4 h-4 text-vscode-inputValidation-infoForeground mt-0.5 flex-shrink-0" />
						<div className="text-sm text-vscode-inputValidation-infoForeground">
							{t("settings:rules.autoApproveRecommendation")}
						</div>
					</div>

					<div className="space-y-4">
						<div>
							<h4 className="text-sm font-medium mb-3">{t("settings:rules.selectTypes")}</h4>
							<div className="grid grid-cols-[repeat(auto-fill,minmax(200px,1fr))] gap-2">
								{ruleTypes.map((ruleType) => (
									<div
										key={ruleType.id}
										onClick={() => handleRuleTypeToggle(ruleType.id)}
										className={cn(
											"relative p-3 rounded-md border cursor-pointer transition-all",
											"hover:border-vscode-focusBorder",
											ruleType.checked
												? "bg-vscode-list-activeSelectionBackground border-vscode-focusBorder"
												: "bg-vscode-editor-background border-vscode-panel-border",
										)}>
										<div className="flex-1">
											<div className="text-sm font-medium flex items-center gap-1">
												{ruleType.label}
												{ruleType.exists && (
													<span
														className="text-vscode-testing-iconQueued"
														title={t("settings:rules.fileExists")}>
														•
													</span>
												)}
											</div>
											<div className="text-xs text-vscode-descriptionForeground mt-1">
												{ruleType.description}
											</div>
										</div>
									</div>
								))}
							</div>
						</div>

						{hasExistingFiles && (
							<div className="flex items-start gap-2 p-3 bg-vscode-inputValidation-warningBackground border border-vscode-inputValidation-warningBorder rounded-md">
								<AlertTriangle className="w-4 h-4 text-vscode-inputValidation-warningForeground mt-0.5 flex-shrink-0" />
								<div className="text-sm text-vscode-inputValidation-warningForeground">
									<div>{t("settings:rules.overwriteWarning")}</div>
									<ul className="mt-1 ml-4 list-disc">
										{existingRules.map((rule) => (
											<li key={rule.id}>{rule.label}</li>
										))}
									</ul>
								</div>
							</div>
						)}

						<div className="border-t border-vscode-panel-border pt-4">
							<label className="flex items-center gap-2 cursor-pointer hover:opacity-80">
								<input
									type="checkbox"
									checked={addToGitignore}
									onChange={(e) => setAddToGitignore(e.target.checked)}
								/>
								<div>
									<div className="text-sm font-medium">{t("settings:rules.addToGitignore")}</div>
									<div className="text-xs text-vscode-descriptionForeground">
										{t("settings:rules.addToGitignoreDescription")}
									</div>
								</div>
							</label>
						</div>

						<div className="border-t border-vscode-panel-border pt-4">
							<label className="flex items-center gap-2 cursor-pointer hover:opacity-80">
								<input
									type="checkbox"
									checked={alwaysAllowWriteProtected}
									onChange={(e) => {
										setAlwaysAllowWriteProtected(e.target.checked)
										vscode.postMessage({
											type: "alwaysAllowWriteProtected",
											bool: e.target.checked,
										})
									}}
								/>
								<div>
									<div className="text-sm font-medium">
										{t("settings:rules.autoApproveProtected")}
									</div>
									<div className="text-xs text-vscode-descriptionForeground">
										{t("settings:rules.autoApproveProtectedDescription")}
									</div>
								</div>
							</label>
						</div>

						<div className="space-y-4">
							<div className="flex items-center gap-3">
								<div className="w-48">
									<label className="text-sm font-medium mb-2 block">
										{t("settings:rules.apiConfigLabel")}
									</label>
									<Select value={selectedApiConfig} onValueChange={setSelectedApiConfig}>
										<SelectTrigger>
											<SelectValue placeholder={t("settings:rules.selectApiConfig")} />
										</SelectTrigger>
										<SelectContent>
											{(listApiConfigMeta || []).map((config) => (
												<SelectItem key={config.id} value={config.name}>
													{config.name}
												</SelectItem>
											))}
										</SelectContent>
									</Select>
								</div>

								<Button
									onClick={handleGenerateRules}
									disabled={isGenerating || !selectedApiConfig}
									variant="default"
									size="default"
									className="mt-6"
									title={t("settings:rules.generateButtonTooltip")}>
									{isGenerating ? (
										<>
											<Loader2 className="mr-2 h-4 w-4 animate-spin" />
											{t("settings:rules.generating")}
										</>
									) : (
										<>
											<FileText className="mr-2 h-4 w-4" />
											{t("settings:rules.generateButton")}
										</>
									)}
								</Button>
							</div>
						</div>

						{isGenerating && (
							<p className="text-vscode-descriptionForeground text-sm">
								{t("settings:rules.creatingTaskDescription")}
							</p>
						)}

						{generationStatus.type === "success" && (
							<div className="text-vscode-testing-iconPassed text-sm">
								<p>{t("settings:rules.taskCreated")}</p>
								<p className="text-vscode-descriptionForeground">{generationStatus.message}</p>
							</div>
						)}

						{generationStatus.type === "error" && (
							<div className="text-vscode-testing-iconFailed text-sm">
								<p>{t("settings:rules.error")}</p>
								<p className="text-vscode-descriptionForeground">
									{t("settings:rules.errorDescription", { error: generationStatus.message })}
								</p>
							</div>
						)}
					</div>
				</div>
			</Section>
		</div>
	)
}
