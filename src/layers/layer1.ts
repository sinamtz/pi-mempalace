/**
 * Layer 1: Essential Story — High-priority memories.
 *
 * The essential story layer contains the most important memories,
 * compressed to fit within a ~500-800 token budget. This layer is
 * loaded during the wake-up sequence and provides context for
 * immediate interactions.
 *
 * Selection criteria:
 * - Top weighted memories by importance score
 * - Recent high-importance memories
 * - Memories with explicit "essential" flag
 */

import { getDb } from "../broker";
import { logger } from "../logger";
import type { Memory } from "../types";

/** Memory record for essential story queries */
interface MemoryRecord {
	id: string;
	text: string;
	embedding: number[];
	wing: string;
	room: string;
	source: string;
	timestamp: Date | string;
	weight?: number;
	essential?: boolean;
}

/** Configuration for essential story generation */
export interface EssentialStoryConfig {
	/** Maximum tokens to use (default: 600) */
	maxTokens?: number;
	/** Average tokens per character (default: 4 for English) */
	tokensPerChar?: number;
	/** Minimum weight threshold (default: 0.8) */
	minWeight?: number;
	/** Include explicitly essential flagged memories */
	includeEssential?: boolean;
}

const DEFAULT_CONFIG: Required<EssentialStoryConfig> = {
	maxTokens: 600,
	tokensPerChar: 4,
	minWeight: 0.8,
	includeEssential: true,
};

/**
 * Generate the essential story context string.
 *
 * Collects the most important memories and formats them as a
 * concise narrative for immediate context.
 *
 * @param config - Configuration options for story generation.
 * @returns A formatted string containing the essential story.
 */
export async function generateEssentialStory(config: EssentialStoryConfig = {}): Promise<string> {
	const cfg = { ...DEFAULT_CONFIG, ...config };
	const maxChars = cfg.maxTokens * cfg.tokensPerChar;

	const memories = await collectEssentialMemories(cfg);

	if (memories.length === 0) {
		return "";
	}

	// Sort by weight (descending) and timestamp (descending for ties)
	const sorted = memories.sort((a, b) => {
		const weightDiff = (b.weight ?? 0) - (a.weight ?? 0);
		if (weightDiff !== 0) return weightDiff;
		const aTime = a.timestamp instanceof Date ? a.timestamp.getTime() : new Date(a.timestamp).getTime();
		const bTime = b.timestamp instanceof Date ? b.timestamp.getTime() : new Date(b.timestamp).getTime();
		return bTime - aTime;
	});

	// Build story text, respecting token budget
	const parts: string[] = [];
	let currentLength = 0;

	for (const memory of sorted) {
		const memoryText = `[${memory.wing}/${memory.room}] ${memory.text}`;
		const neededLength = memoryText.length + 1; // +1 for newline

		if (currentLength + neededLength > maxChars) {
			// Check if we should include this memory anyway if it's short
			if (memoryText.length < maxChars * 0.1 && parts.length < 10) {
				parts.push(memoryText);
				currentLength += neededLength;
			}
			break;
		}

		parts.push(memoryText);
		currentLength += neededLength;
	}

	logger.debug("Essential story generated", {
		memoryCount: parts.length,
		charLength: currentLength,
		estimatedTokens: Math.ceil(currentLength / cfg.tokensPerChar),
	});

	return parts.join("\n");
}

/**
 * Collect memories for the essential story layer.
 */
async function collectEssentialMemories(_cfg: Required<EssentialStoryConfig>): Promise<MemoryRecord[]> {
	const db = getDb();

	// Query for high-weight or essential memories
	// In a real implementation, we'd have a weight field on memories
	// For now, we use a heuristic: recent memories from key wings

	const results = await db.query<MemoryRecord[]>(`
		SELECT
			id,
			text,
			embedding,
			wing,
			room,
			source,
			timestamp
		FROM memory
		WHERE
			(wing = 'identity' OR wing = 'core' OR wing = 'projects')
			AND timestamp > time::now() - 7d
		ORDER BY timestamp DESC
		LIMIT 20;
	`);

	return results ?? [];
}

/**
 * Check if essential story should be refreshed.
 *
 * @param lastRefresh - When the story was last generated.
 * @param refreshIntervalMs - How often to refresh (default: 1 hour).
 * @returns True if refresh is needed.
 */
export function shouldRefreshEssentialStory(lastRefresh: Date | null, refreshIntervalMs = 3600000): boolean {
	if (!lastRefresh) return true;
	return Date.now() - lastRefresh.getTime() > refreshIntervalMs;
}

/**
 * Cached essential story state.
 */
interface EssentialStoryState {
	story: string;
	generatedAt: Date;
	memoryIds: string[];
}

let cachedStory: EssentialStoryState | null = null;

/**
 * Get the cached essential story if still valid.
 */
export function getCachedEssentialStory(): EssentialStoryState | null {
	if (!cachedStory) return null;
	if (shouldRefreshEssentialStory(cachedStory.generatedAt)) {
		cachedStory = null;
		return null;
	}
	return cachedStory;
}

/**
 * Generate and cache the essential story.
 */
export async function getEssentialStory(config: EssentialStoryConfig = {}): Promise<string> {
	const cached = getCachedEssentialStory();
	if (cached) {
		return cached.story;
	}

	const story = await generateEssentialStory(config);
	const memories = await collectEssentialMemories({ ...DEFAULT_CONFIG, ...config });

	cachedStory = {
		story,
		generatedAt: new Date(),
		memoryIds: memories.map(m => String(m.id)),
	};

	return story;
}

/**
 * Clear the essential story cache.
 */
export function clearEssentialStoryCache(): void {
	cachedStory = null;
}

/**
 * Format a memory for inclusion in the essential story.
 */
export function formatEssentialMemory(memory: Memory): string {
	return `[${memory.wing}/${memory.room}] ${memory.text}`;
}
