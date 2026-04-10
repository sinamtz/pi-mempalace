/**
 * Embedding generation using @huggingface/transformers.
 *
 * Wraps the all-MiniLM-L6-v2 model for generating 384-dimensional
 * semantic embeddings. Uses ONNX runtime for efficient inference.
 *
 * Compatible with @huggingface/transformers v4.x.
 */

import { pipeline, env } from "@huggingface/transformers";
import type { FeatureExtractionPipeline } from "@huggingface/transformers";
import { logger } from "./logger";
import { EMBEDDING_CONFIG, type Embedding } from "./types";

// Configure transformers for optimal performance
env.allowLocalModels = false;
env.useBrowserCache = false;

// Set up WASM threading
if (env.backends?.onnx?.wasm) {
	env.backends.onnx.wasm.numThreads = 4;
}

/** Singleton embedding pipeline instance. */
let embeddingPipeline: FeatureExtractionPipeline | null = null;

/** Whether the pipeline is currently loading. */
let isLoading = false;

/**
 * Get or create the embedding pipeline.
 *
 * The pipeline is lazily initialized on first use and cached
 * for subsequent calls.
 */
async function getPipeline(): Promise<FeatureExtractionPipeline> {
	if (embeddingPipeline) {
		return embeddingPipeline;
	}

	if (isLoading) {
		// Wait for existing load to complete
		while (isLoading) {
			await new Promise(resolve => setTimeout(resolve, 100));
		}
		if (embeddingPipeline) {
			return embeddingPipeline;
		}
	}

	isLoading = true;
	logger.debug("Loading embedding model", { model: EMBEDDING_CONFIG.MODEL });

	try {
		embeddingPipeline = (await pipeline("feature-extraction", EMBEDDING_CONFIG.MODEL, {
			device: EMBEDDING_CONFIG.DEVICE as "cpu" | "cuda",
		})) as FeatureExtractionPipeline;

		logger.info("Embedding model loaded", {
			model: EMBEDDING_CONFIG.MODEL,
			dimension: EMBEDDING_CONFIG.DIMENSION,
		});
	} finally {
		isLoading = false;
	}

	return embeddingPipeline!;
}

/**
 * Generate an embedding vector for the given text.
 *
 * Uses all-MiniLM-L6-v2 to produce a 384-dimensional vector
 * representing the semantic meaning of the input text.
 *
 * @param text - The text to embed. Will be truncated if too long.
 * @returns Promise resolving to a 384-dimensional Float32Array.
 * @throws Error if embedding generation fails.
 *
 * @example
 * ```typescript
 * const embedding = await embed("The quick brown fox jumps over the lazy dog");
 * console.log(`Got ${embedding.length}-dimensional embedding`);
 * ```
 */
export async function embed(text: string): Promise<Embedding> {
	const pipe = await getPipeline();

	// Truncate text if too long (approximate token limit)
	const truncatedText = truncateText(text, EMBEDDING_CONFIG.MAX_LENGTH);

	const startTime = performance.now();

	const output = await pipe(truncatedText, {
		pooling: "mean",
		normalize: true,
	});

	const duration = performance.now() - startTime;

	// Convert tensor to Float32Array
	// The output from pooling='mean' should be [1, 384]
	const dims = output.dims;

	let embedding: Float32Array;

	if (dims.length === 2 && dims[0] === 1) {
		// Already pooled: [batch, hidden]
		const data = output.data;
		if (data instanceof Float32Array) {
			embedding = data;
		} else {
			embedding = new Float32Array(data as ArrayLike<number>);
		}
	} else if (dims.length === 3) {
		// Not pooled: [batch, sequence, hidden] - need to mean pool
		const data = output.data;
		const typedData = data instanceof Float32Array ? data : new Float32Array(data as ArrayLike<number>);
		embedding = new Float32Array(EMBEDDING_CONFIG.DIMENSION);

		// Mean pool across sequence dimension
		const seqLen = dims[1];
		for (let i = 0; i < EMBEDDING_CONFIG.DIMENSION; i++) {
			let sum = 0;
			for (let j = 0; j < seqLen; j++) {
				sum += typedData[j * EMBEDDING_CONFIG.DIMENSION + i];
			}
			embedding[i] = sum / seqLen;
		}
	} else {
		throw new Error(`Unexpected output shape: [${dims.join(",")}]`);
	}

	// Validate dimension
	if (embedding.length !== EMBEDDING_CONFIG.DIMENSION) {
		logger.warn("Embedding dimension mismatch", {
			expected: EMBEDDING_CONFIG.DIMENSION,
			actual: embedding.length,
		});

		// Resize if necessary
		if (embedding.length > EMBEDDING_CONFIG.DIMENSION) {
			embedding = embedding.slice(0, EMBEDDING_CONFIG.DIMENSION);
		} else {
			const padded = new Float32Array(EMBEDDING_CONFIG.DIMENSION);
			padded.set(embedding);
			embedding = padded;
		}
	}

	logger.debug("Embedding generated", {
		textLength: text.length,
		duration: Math.round(duration * 100) / 100,
	});

	return embedding;
}

/**
 * Generate embeddings for multiple texts in batch.
 *
 * @param texts - Array of texts to embed.
 * @returns Promise resolving to array of embeddings.
 */
export async function embedBatch(texts: string[]): Promise<Embedding[]> {
	const pipe = await getPipeline();

	const startTime = performance.now();

	const outputs = await Promise.all(
		texts.map(text => {
			const truncatedText = truncateText(text, EMBEDDING_CONFIG.MAX_LENGTH);
			return pipe(truncatedText, {
				pooling: "mean",
				normalize: true,
			});
		}),
	);

	const duration = performance.now() - startTime;

	const embeddings: Embedding[] = [];

	for (const output of outputs) {
		const dims = output.dims;
		let embedding: Float32Array;

		if (dims.length === 2 && dims[0] === 1) {
			const data = output.data;
			if (data instanceof Float32Array) {
				embedding = data;
			} else {
				embedding = new Float32Array(data as ArrayLike<number>);
			}
		} else {
			// Mean pool if needed
			const data = output.data;
			const typedData = data instanceof Float32Array ? data : new Float32Array(data as ArrayLike<number>);
			embedding = new Float32Array(EMBEDDING_CONFIG.DIMENSION);
			const seqLen = dims[1];
			for (let i = 0; i < EMBEDDING_CONFIG.DIMENSION; i++) {
				let sum = 0;
				for (let j = 0; j < seqLen; j++) {
					sum += typedData[j * EMBEDDING_CONFIG.DIMENSION + i];
				}
				embedding[i] = sum / seqLen;
			}
		}

		// Normalize to expected dimension
		if (embedding.length !== EMBEDDING_CONFIG.DIMENSION) {
			if (embedding.length > EMBEDDING_CONFIG.DIMENSION) {
				embedding = embedding.slice(0, EMBEDDING_CONFIG.DIMENSION);
			} else {
				const padded = new Float32Array(EMBEDDING_CONFIG.DIMENSION);
				padded.set(embedding);
				embedding = padded;
			}
		}

		embeddings.push(embedding);
	}

	logger.debug("Batch embeddings generated", {
		count: texts.length,
		duration: Math.round(duration * 100) / 100,
	});

	return embeddings;
}

/**
 * Check if the embedding pipeline is ready.
 */
export function isEmbedReady(): boolean {
	return embeddingPipeline !== null;
}

/**
 * Unload the embedding pipeline to free memory.
 */
export async function unloadEmbed(): Promise<void> {
	if (embeddingPipeline) {
		logger.debug("Unloading embedding model");
		// Dispose the pipeline
		if (typeof (embeddingPipeline as { dispose?: () => void }).dispose === "function") {
			(embeddingPipeline as { dispose: () => void }).dispose();
		}
		embeddingPipeline = null;
		logger.info("Embedding model unloaded");
	}
}

/**
 * Truncate text to a maximum length.
 *
 * Simple character-based truncation with ellipsis.
 * For production, consider token-based truncation.
 */
function truncateText(text: string, maxLength: number): string {
	if (text.length <= maxLength) {
		return text;
	}

	// Find a good break point (end of sentence or word)
	const truncated = text.slice(0, maxLength);
	const lastSentence = truncated.lastIndexOf(".");
	const lastSpace = truncated.lastIndexOf(" ");

	const breakPoint =
		lastSentence > maxLength * 0.7 ? lastSentence + 1 : lastSpace > maxLength * 0.7 ? lastSpace : maxLength;

	return text.slice(0, breakPoint);
}

/**
 * Validate that an embedding has the correct dimension.
 *
 * @param embedding - The embedding to validate.
 * @returns True if the embedding has the expected dimension.
 */
export function validateEmbedding(embedding: Embedding): boolean {
	return embedding.length === EMBEDDING_CONFIG.DIMENSION;
}
