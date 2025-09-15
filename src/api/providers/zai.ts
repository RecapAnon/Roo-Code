import {
	internationalZAiModels,
	mainlandZAiModels,
	internationalZAiDefaultModelId,
	mainlandZAiDefaultModelId,
	type InternationalZAiModelId,
	type MainlandZAiModelId,
	ZAI_DEFAULT_TEMPERATURE,
} from "@roo-code/types"

import type { ApiHandlerOptions } from "../../shared/api"

import { BaseOpenAiCompatibleProvider } from "./base-openai-compatible-provider"

export class ZAiHandler extends BaseOpenAiCompatibleProvider<InternationalZAiModelId | MainlandZAiModelId> {
	constructor(options: ApiHandlerOptions) {
		const isChina = options.zaiApiLine === "china"
		const models = isChina ? mainlandZAiModels : internationalZAiModels
		const defaultModelId = isChina ? mainlandZAiDefaultModelId : internationalZAiDefaultModelId

		// Determine the base URL based on region and GLM Coding Plan toggle
		let baseURL: string
		if (options.zaiUseGlmCodingPlan) {
			// Use coding plan endpoints
			baseURL = isChina ? "https://open.bigmodel.cn/api/coding/paas/v4" : "https://api.z.ai/api/coding/paas/v4"
		} else {
			// Use standard endpoints
			baseURL = isChina ? "https://open.bigmodel.cn/api/paas/v4" : "https://api.z.ai/api/paas/v4"
		}

		super({
			...options,
			providerName: "Z AI",
			baseURL,
			apiKey: options.zaiApiKey ?? "not-provided",
			defaultProviderModelId: defaultModelId,
			providerModels: models,
			defaultTemperature: ZAI_DEFAULT_TEMPERATURE,
		})
	}
}
