/**
 * Layer 3: Deep Search — Full semantic vector search.
 *
 * The deep search layer provides semantic similarity search across
 * all memories. Unlike Layer 2 (on-demand), this layer uses vector
 * embeddings to find conceptually related memories regardless of
 * spatial metadata.
 *
 * Use cases:
 * - Finding memories similar to a query
 * - Discovering related concepts across wings
 * - Context-aware suggestions based on current task
 */

import { getDb } from "../broker";
import { embed } from "../embed";
import { queryMemories } from "../memory";
import type { Embedding, MemoryResult } from "../types";
import { logger } from "../logger";

/** Configuration for deep search */
export interface DeepSearchConfig {
	/** Maximum results to return (default: 10) */
	limit?: number;
	/** Minimum similarity score (0-1, default: 0.0) */
	minScore?: number;
	/** Restrict search to specific wing */
	wing?: string;
	/** Restrict search to specific room */
	room?: string;
	/** Restrict search to specific source */
	source?: string;
	/** Expand search to related wings */
	expandWings?: string[];
}

/** Result of a deep search query */
export interface DeepSearchResult {
	/** Query that was searched */
	query: string;
	/** Query embedding (for debugging/caching) */
	queryEmbedding: Embedding;
	/** Search timestamp */
	searchedAt: Date;
	/** Time taken for search (ms) */
	durationMs: number;
	/** Matching memories with scores */
	matches: MemoryResult[];
	/** Whether results were limited by score threshold */
	truncated: boolean;
	/** Applied filters */
	filters: {
		wing?: string;
		room?: string;
		source?: string;
		expandWings?: string[];
	};
}

/**
 * Perform a semantic search across all memories.
 *
 * This is the primary interface for Layer 3 access. It embeds the
 * query text and finds the most similar memories using cosine similarity
 * on the HNSW index.
 *
 * @param query - Text query to search for.
 * @param config - Search configuration.
 * @returns Search results with similarity scores.
 */
export async function search(query: string, config: DeepSearchConfig = {}): Promise<DeepSearchResult> {
	const startTime = performance.now();

	const { limit = 10, minScore = 0.0, wing, room, source, expandWings } = config;

	// Generate embedding for query
	const queryEmbedding = await embed(query);

	// Build wing list (original + expanded)
	const targetWings = wing ? (expandWings ? [wing, ...expandWings] : [wing]) : undefined;

	// Perform vector search
	const matches = await queryMemories(queryEmbedding, {
		limit: limit * 2, // Fetch extra for filtering
		wing: targetWings && targetWings.length === 1 ? targetWings[0] : undefined,
		room,
		source,
		minScore,
	});

	// Apply multi-wing filter if needed
	let filteredMatches = matches;
	if (targetWings && targetWings.length > 1) {
		filteredMatches = matches.filter(m => targetWings.includes(m.memory.wing));
	}

	// Apply limit
	const limitedMatches = filteredMatches.slice(0, limit);

	const durationMs = performance.now() - startTime;

	logger.debug("Deep search completed", {
		queryLength: query.length,
		resultCount: limitedMatches.length,
		durationMs: Math.round(durationMs * 100) / 100,
	});

	return {
		query,
		queryEmbedding,
		searchedAt: new Date(),
		durationMs,
		matches: limitedMatches,
		truncated: filteredMatches.length > limit,
		filters: {
			wing,
			room,
			source,
			expandWings,
		},
	};
}

/**
 * Search with an existing embedding.
 *
 * Use this when you have a pre-computed embedding and want to
 * avoid re-embedding the query.
 *
 * @param queryEmbedding - Pre-computed embedding.
 * @param query - Original query text (for logging/debugging).
 * @param config - Search configuration.
 * @returns Search results with similarity scores.
 */
export async function searchWithEmbedding(
	queryEmbedding: Embedding,
	query: string,
	config: DeepSearchConfig = {},
): Promise<DeepSearchResult> {
	const startTime = performance.now();

	const { limit = 10, minScore = 0.0, wing, room, source, expandWings } = config;

	// Build wing list (original + expanded)
	const targetWings = wing ? (expandWings ? [wing, ...expandWings] : [wing]) : undefined;

	// Perform vector search
	const matches = await queryMemories(queryEmbedding, {
		limit: limit * 2,
		wing: targetWings && targetWings.length === 1 ? targetWings[0] : undefined,
		room,
		source,
		minScore,
	});

	// Apply multi-wing filter if needed
	let filteredMatches = matches;
	if (targetWings && targetWings.length > 1) {
		filteredMatches = matches.filter(m => targetWings.includes(m.memory.wing));
	}

	// Apply limit
	const limitedMatches = filteredMatches.slice(0, limit);

	const durationMs = performance.now() - startTime;

	logger.debug("Deep search with embedding completed", {
		queryLength: query.length,
		resultCount: limitedMatches.length,
		durationMs: Math.round(durationMs * 100) / 100,
	});

	return {
		query,
		queryEmbedding,
		searchedAt: new Date(),
		durationMs,
		matches: limitedMatches,
		truncated: filteredMatches.length > limit,
		filters: {
			wing,
			room,
			source,
			expandWings,
		},
	};
}

/**
 * Find related memories to a specific memory.
 *
 * @param memoryId - ID of the reference memory.
 * @param options - Search options.
 * @returns Memories similar to the reference.
 */
export async function findSimilarMemories(
	memoryId: string,
	options: {
		limit?: number;
		minScore?: number;
		excludeSelf?: boolean;
	} = {},
): Promise<MemoryResult[]> {
	const { limit = 10, minScore = 0.0, excludeSelf = true } = options;

	// Get the reference memory
	const db = getDb();
	const { StringRecordId } = await import("surrealdb");

	const record = await db.select<{
		embedding: number[];
		wing: string;
		room: string;
	}>(new StringRecordId(memoryId));

	if (!record) {
		logger.warn("Memory not found for similarity search", { memoryId });
		return [];
	}

	const queryEmbedding = Float32Array.from(record.embedding);

	const matches = await queryMemories(queryEmbedding, {
		limit: excludeSelf ? limit + 1 : limit,
		wing: record.wing,
		room: record.room,
		minScore,
	});

	// Exclude self if requested
	const filtered = excludeSelf ? matches.filter(m => m.memory.id !== memoryId) : matches;

	return filtered.slice(0, limit);
}

/**
 * Discover related concepts across wings.
 *
 * Takes a memory and finds conceptually similar memories in
 * different wings, useful for cross-pollination of ideas.
 *
 * @param memoryId - ID of the reference memory.
 * @param options - Discovery options.
 * @returns Related memories organized by wing.
 */
export async function discoverConcepts(
	memoryId: string,
	options: {
		limitPerWing?: number;
		minScore?: number;
		excludeWings?: string[];
	} = {},
): Promise<Map<string, MemoryResult[]>> {
	const { limitPerWing = 5, minScore = 0.3, excludeWings = [] } = options;

	// Get the reference memory
	const db = getDb();
	const { StringRecordId } = await import("surrealdb");

	const record = await db.select<{
		embedding: number[];
		wing: string;
		room: string;
	}>(new StringRecordId(memoryId));

	if (!record) {
		logger.warn("Memory not found for concept discovery", { memoryId });
		return new Map();
	}

	const queryEmbedding = Float32Array.from(record.embedding);

	// Search with broad parameters
	const matches = await queryMemories(queryEmbedding, {
		limit: 100,
		minScore,
	});

	// Group by wing
	const byWing = new Map<string, MemoryResult[]>();

	for (const match of matches) {
		if (match.memory.id === memoryId) continue;
		if (excludeWings.includes(match.memory.wing)) continue;

		const existing = byWing.get(match.memory.wing) ?? [];
		if (existing.length < limitPerWing) {
			existing.push(match);
			byWing.set(match.memory.wing, existing);
		}
	}

	return byWing;
}

/**
 * Suggest context-aware memories for the current task.
 *
 * Analyzes recent memories and queries to suggest relevant
 * context for the current working context.
 *
 * @param currentTask - Description of current task.
 * @param recentContext - Recent memory IDs or descriptions.
 * @param options - Suggestion options.
 * @returns Suggested memories with relevance scores.
 */
export async function suggestContext(
	currentTask: string,
	_recentContext: string[] = [],
	options: {
		limit?: number;
		recentDays?: number;
	} = {},
): Promise<MemoryResult[]> {
	const { limit = 5, recentDays = 7 } = options;

	const db = getDb();

	// Get recent memories from last few days
	const cutoff = new Date();
	cutoff.setDate(cutoff.getDate() - recentDays);

	const recentMemories = await db.query<
		Array<{
			id: string;
			text: string;
			embedding: number[];
			wing: string;
			room: string;
		}>
	>(
		`SELECT id, text, embedding, wing, room FROM memory
		 WHERE timestamp > $cutoff
		 ORDER BY timestamp DESC
		 LIMIT 50;`,
		{ cutoff },
	);

	if (!recentMemories || recentMemories.length === 0) {
		// Fall back to pure semantic search
		const result = await search(currentTask, { limit });
		return result.matches;
	}

	// Find most relevant recent memories
	const taskEmbedding = await embed(currentTask);

	const scored = recentMemories.map(memory => {
		const memEmbedding = Float32Array.from(memory.embedding);
		const score = cosineSimilarity(taskEmbedding, memEmbedding);
		return {
			memory: {
				id: memory.id,
				text: memory.text,
				embedding: Float32Array.from(memory.embedding),
				wing: memory.wing,
				room: memory.room,
				source: "",
				timestamp: new Date(),
			},
			score,
		};
	});

	// Sort by score and return top matches
	scored.sort((a, b) => b.score - a.score);

	return scored.slice(0, limit).map(s => ({
		memory: s.memory,
		score: s.score,
	}));
}

/**
 * Calculate cosine similarity between two embeddings.
 */
function cosineSimilarity(a: Float32Array, b: Float32Array): number {
	let dotProduct = 0;
	let normA = 0;
	let normB = 0;

	for (let i = 0; i < a.length; i++) {
		dotProduct += a[i] * b[i];
		normA += a[i] * a[i];
		normB += b[i] * b[i];
	}

	return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
