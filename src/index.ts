/**
 * MemPalace — Semantic memory palace for Pi.
 *
 * Provides persistent vector storage with HNSW indexing for semantic search,
 * entity knowledge graphs with temporal versioning, and embedding generation
 * via all-MiniLM-L6-v2.
 *
 * Phase 5 adds higher-level features:
 * - Layered retrieval (L0-L3)
 * - Onboarding flow
 * - Agent diary
 * - Palace protocol
 *
 * @example
 * ```typescript
 * import {
 *   init,
 *   addMemory,
 *   queryMemories,
 *   embed,
 *   close,
 * } from "pi-mempalace";
 *
 * // Initialize the database
 * await init();
 *
 * // Add a memory
 * const embedding = await embed("The project uses TypeScript");
 * const memory = await addMemory({
 *   text: "The project uses TypeScript",
 *   embedding,
 *   wing: "work",
 *   room: "tech-stack",
 *   source: "repo-scan",
 * });
 *
 * // Search for related memories
 * const results = await queryMemories(embedding, {
 *   wing: "work",
 *   limit: 5,
 * });
 *
 * // Clean up when done
 * await close();
 * ```
 */

// Re-export types for consumers
export type {
	Embedding,
	Memory,
	MemoryId,
	MemoryInput,
	MemoryUpdate,
	MemoryResult,
	Person,
	PersonId,
	PersonInput,
	Edge,
	EdgeInput,
	EdgeType,
	QueryOptions,
} from "./types";

// Re-export constants
export { EDGE_TYPES, HNSW_CONFIG, EMBEDDING_CONFIG, PATHS } from "./types";

// Database lifecycle (Auto-Server broker)
export { connectDb as initDb, closeDb, getDb, getDataDir, isDbInitialized } from "./broker";

// Config system
export { loadConfig, saveConfig, getConfigPath, DEFAULT_CONFIG, type Config } from "./config";

// Memory operations
export {
	addMemory,
	upsertMemory,
	deleteMemory,
	getMemory,
	queryMemories,
	listMemories,
	countMemories,
	addMemories,
} from "./memory";

// Embedding generation
export { embed, embedBatch, isEmbedReady, unloadEmbed, validateEmbedding } from "./embed";

// Layer exports
export {
	loadIdentity,
	saveIdentity,
	hasIdentity,
	getIdentityPath,
	getIdentitySync,
	clearIdentityCache,
	DEFAULT_IDENTITY_TEMPLATE,
	generateEssentialStory,
	getEssentialStory,
	getCachedEssentialStory,
	clearEssentialStoryCache,
	shouldRefreshEssentialStory,
	formatEssentialMemory,
	retrieveByLocation,
	listWings,
	listRoomsInWing,
	getWingStats,
	exploreWing,
	navigateToRoom,
	search,
	searchWithEmbedding,
	findSimilarMemories,
	discoverConcepts,
	suggestContext,
	MemoryStack,
	getMemoryStack,
	type WakeUpContext,
	type RetrievalRequest,
	type RetrievalResult,
	type PalaceOverview,
	type EssentialStoryConfig,
	type OnDemandConfig,
	type OnDemandResult,
	type WingStats,
	type WingExploration,
	type RoomNavigation,
	type DeepSearchConfig,
	type DeepSearchResult,
} from "./layers";

// Onboarding exports
export {
	isOnboardingNeeded,
	loadOnboardingState,
	saveOnboardingState,
	startOnboarding,
	submitUserInfo,
	generateWingConfig,
	submitWingConfig,
	seedInitialMemories,
	saveOnboardingIdentity,
	completeOnboarding,
	runOnboarding,
	resetOnboarding,
	DEFAULT_WING_CONFIG,
	type OnboardingState,
	type OnboardingStep,
	type UserInfo,
	type WingConfig,
} from "./onboarding";

// Diary exports
export {
	createEntry,
	startSession,
	endSession,
	createDailySummary,
	createReflection,
	recordMilestone,
	getActiveSession,
	getRecentEntries,
	getDiaryStats,
	type DiaryEntryType,
	type DiaryEntry,
	type Session,
	type DailySummary,
	type DiaryConfig,
} from "./diary";

// Protocol exports
export {
	PROTOCOL_VERSION,
	DEFAULT_TOKEN_BUDGET,
	wakeUp,
	buildContext,
	formatAttributions,
	queryPalace,
	clearWakeUpCache,
	quickRecall,
	explorePalace,
	injectContext,
	getProtocolStatus,
	type TokenBudget,
	type MemoryAttribution,
	type MemoryContextResponse,
	type ProtocolConfig,
} from "./protocol";

/**
 * Initialize MemPalace with default settings.
 *
 * Convenience function that calls connectDb() with default configuration.
 * Use this for simple setups; use connectDb() directly for custom options.
 */
export async function init(options?: { dataDir?: string }): Promise<void> {
	const { connectDb } = await import("./broker");
	await connectDb(options);
}

/**
 * Close MemPalace and release resources.
 *
 * Convenience function that calls closeDb() and unloadEmbed().
 */
export async function close(): Promise<void> {
	const { closeDb } = await import("./broker");
	const { unloadEmbed } = await import("./embed");
	await Promise.all([closeDb(), unloadEmbed()]);
}
