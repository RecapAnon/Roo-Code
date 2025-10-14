import { BedrockRuntimeClient, InvokeModelCommand, InvokeModelCommandInput } from "@aws-sdk/client-bedrock-runtime"
import { fromEnv, fromIni } from "@aws-sdk/credential-providers"
import { IEmbedder, EmbeddingResponse, EmbedderInfo } from "../interfaces"
import {
	MAX_BATCH_TOKENS,
	MAX_ITEM_TOKENS,
	MAX_BATCH_RETRIES as MAX_RETRIES,
	INITIAL_RETRY_DELAY_MS as INITIAL_DELAY_MS,
} from "../constants"
import { getDefaultModelId } from "../../../shared/embeddingModels"
import { t } from "../../../i18n"
import { withValidationErrorHandling, formatEmbeddingError, HttpError } from "../shared/validation-helpers"
import { TelemetryEventName } from "@roo-code/types"
import { TelemetryService } from "@roo-code/telemetry"

/**
 * AWS Bedrock implementation of the embedder interface with batching and rate limiting
 */
export class BedrockEmbedder implements IEmbedder {
	private bedrockClient: BedrockRuntimeClient
	private readonly defaultModelId: string

	/**
	 * Creates a new AWS Bedrock embedder
	 * @param region AWS region for Bedrock service
	 * @param modelId Optional model ID override
	 * @param profile Optional AWS profile name for credentials
	 */
	constructor(
		private readonly region: string = "us-east-1",
		modelId?: string,
		private readonly profile?: string,
	) {
		// Initialize the Bedrock client with appropriate credentials
		const credentials = this.profile ? fromIni({ profile: this.profile }) : fromEnv()

		this.bedrockClient = new BedrockRuntimeClient({
			region: this.region,
			credentials,
		})

		this.defaultModelId = modelId || getDefaultModelId("bedrock")
	}

	/**
	 * Creates embeddings for the given texts with batching and rate limiting
	 * @param texts Array of text strings to embed
	 * @param model Optional model identifier
	 * @returns Promise resolving to embedding response
	 */
	async createEmbeddings(texts: string[], model?: string): Promise<EmbeddingResponse> {
		const modelToUse = model || this.defaultModelId

		const allEmbeddings: number[][] = []
		const usage = { promptTokens: 0, totalTokens: 0 }
		const remainingTexts = [...texts]

		while (remainingTexts.length > 0) {
			const currentBatch: string[] = []
			let currentBatchTokens = 0
			const processedIndices: number[] = []

			for (let i = 0; i < remainingTexts.length; i++) {
				const text = remainingTexts[i]
				const itemTokens = Math.ceil(text.length / 4)

				if (itemTokens > MAX_ITEM_TOKENS) {
					console.warn(
						t("embeddings:textExceedsTokenLimit", {
							index: i,
							itemTokens,
							maxTokens: MAX_ITEM_TOKENS,
						}),
					)
					processedIndices.push(i)
					continue
				}

				if (currentBatchTokens + itemTokens <= MAX_BATCH_TOKENS) {
					currentBatch.push(text)
					currentBatchTokens += itemTokens
					processedIndices.push(i)
				} else {
					break
				}
			}

			// Remove processed items from remainingTexts (in reverse order to maintain correct indices)
			for (let i = processedIndices.length - 1; i >= 0; i--) {
				remainingTexts.splice(processedIndices[i], 1)
			}

			if (currentBatch.length > 0) {
				const batchResult = await this._embedBatchWithRetries(currentBatch, modelToUse)
				allEmbeddings.push(...batchResult.embeddings)
				usage.promptTokens += batchResult.usage.promptTokens
				usage.totalTokens += batchResult.usage.totalTokens
			}
		}

		return { embeddings: allEmbeddings, usage }
	}

	/**
	 * Helper method to handle batch embedding with retries and exponential backoff
	 * @param batchTexts Array of texts to embed in this batch
	 * @param model Model identifier to use
	 * @returns Promise resolving to embeddings and usage statistics
	 */
	private async _embedBatchWithRetries(
		batchTexts: string[],
		model: string,
	): Promise<{ embeddings: number[][]; usage: { promptTokens: number; totalTokens: number } }> {
		for (let attempts = 0; attempts < MAX_RETRIES; attempts++) {
			try {
				const embeddings: number[][] = []
				let totalPromptTokens = 0
				let totalTokens = 0

				// Process each text in the batch
				// Note: Amazon Titan models typically don't support batch embedding in a single request
				// So we process them individually
				for (const text of batchTexts) {
					const embedding = await this._invokeEmbeddingModel(text, model)
					embeddings.push(embedding.embedding)
					totalPromptTokens += embedding.inputTextTokenCount || 0
					totalTokens += embedding.inputTextTokenCount || 0
				}

				return {
					embeddings,
					usage: {
						promptTokens: totalPromptTokens,
						totalTokens,
					},
				}
			} catch (error: any) {
				const hasMoreAttempts = attempts < MAX_RETRIES - 1

				// Check if it's a rate limit error
				if (error.name === "ThrottlingException" && hasMoreAttempts) {
					const delayMs = INITIAL_DELAY_MS * Math.pow(2, attempts)
					console.warn(
						t("embeddings:rateLimitRetry", {
							delayMs,
							attempt: attempts + 1,
							maxRetries: MAX_RETRIES,
						}),
					)
					await new Promise((resolve) => setTimeout(resolve, delayMs))
					continue
				}

				// Capture telemetry before reformatting the error
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					location: "BedrockEmbedder:_embedBatchWithRetries",
					attempt: attempts + 1,
				})

				// Log the error for debugging
				console.error(`Bedrock embedder error (attempt ${attempts + 1}/${MAX_RETRIES}):`, error)

				// Format and throw the error
				throw formatEmbeddingError(error, MAX_RETRIES)
			}
		}

		throw new Error(t("embeddings:failedMaxAttempts", { attempts: MAX_RETRIES }))
	}

	/**
	 * Invokes the embedding model for a single text
	 * @param text The text to embed
	 * @param model The model identifier to use
	 * @returns Promise resolving to embedding and token count
	 */
	private async _invokeEmbeddingModel(
		text: string,
		model: string,
	): Promise<{ embedding: number[]; inputTextTokenCount?: number }> {
		let requestBody: any
		let modelId = model

		// Prepare the request body based on the model
		if (model.startsWith("amazon.titan-embed")) {
			requestBody = {
				inputText: text,
			}
		} else if (model.startsWith("cohere.embed")) {
			requestBody = {
				texts: [text],
				input_type: "search_document", // or "search_query" depending on use case
			}
		} else {
			// Default to Titan format
			requestBody = {
				inputText: text,
			}
		}

		const params: InvokeModelCommandInput = {
			modelId,
			body: JSON.stringify(requestBody),
			contentType: "application/json",
			accept: "application/json",
		}

		const command = new InvokeModelCommand(params)
		const response = await this.bedrockClient.send(command)

		// Parse the response
		const responseBody = JSON.parse(new TextDecoder().decode(response.body))

		// Extract embedding based on model type
		if (model.startsWith("amazon.titan-embed")) {
			return {
				embedding: responseBody.embedding,
				inputTextTokenCount: responseBody.inputTextTokenCount,
			}
		} else if (model.startsWith("cohere.embed")) {
			return {
				embedding: responseBody.embeddings[0],
				// Cohere doesn't provide token count in response
			}
		} else {
			// Default to Titan format
			return {
				embedding: responseBody.embedding,
				inputTextTokenCount: responseBody.inputTextTokenCount,
			}
		}
	}

	/**
	 * Validates the Bedrock embedder configuration by attempting a minimal embedding request
	 * @returns Promise resolving to validation result with success status and optional error message
	 */
	async validateConfiguration(): Promise<{ valid: boolean; error?: string }> {
		return withValidationErrorHandling(async () => {
			try {
				// Test with a minimal embedding request
				const result = await this._invokeEmbeddingModel("test", this.defaultModelId)

				// Check if we got a valid response
				if (!result.embedding || result.embedding.length === 0) {
					return {
						valid: false,
						error: t("embeddings:bedrock.invalidResponseFormat"),
					}
				}

				return { valid: true }
			} catch (error: any) {
				// Check for specific AWS errors
				if (error.name === "UnrecognizedClientException") {
					return {
						valid: false,
						error: t("embeddings:bedrock.invalidCredentials"),
					}
				}

				if (error.name === "AccessDeniedException") {
					return {
						valid: false,
						error: t("embeddings:bedrock.accessDenied"),
					}
				}

				if (error.name === "ResourceNotFoundException") {
					return {
						valid: false,
						error: t("embeddings:bedrock.modelNotFound", { model: this.defaultModelId }),
					}
				}

				// Capture telemetry for validation errors
				TelemetryService.instance.captureEvent(TelemetryEventName.CODE_INDEX_ERROR, {
					error: error instanceof Error ? error.message : String(error),
					stack: error instanceof Error ? error.stack : undefined,
					location: "BedrockEmbedder:validateConfiguration",
				})
				throw error
			}
		}, "bedrock")
	}

	get embedderInfo(): EmbedderInfo {
		return {
			name: "bedrock",
		}
	}
}
