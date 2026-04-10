/**
 * Memory Layers — Hierarchical retrieval system.
 *
 * The memory palace uses a layered retrieval architecture:
 * - L0 (Identity): Always-loaded core identity
 * - L1 (Essential Story): High-priority compressed memories
 * - L2 (On-Demand): Wing/room filtered access
 * - L3 (Deep Search): Full semantic vector search
 *
 * The MemoryStack provides unified access to all layers.
 */

// Re-export layer modules
export {
	loadIdentity,
	saveIdentity,
	hasIdentity,
	getIdentityPath,
	getIdentitySync,
	clearIdentityCache,
	DEFAULT_IDENTITY_TEMPLATE,
} from "./layer0";

export {
	generateEssentialStory,
	getEssentialStory,
	getCachedEssentialStory,
	clearEssentialStoryCache,
	shouldRefreshEssentialStory,
	formatEssentialMemory,
	type EssentialStoryConfig,
} from "./layer1";

export {
	retrieveByLocation,
	listWings,
	listRoomsInWing,
	getWingStats,
	exploreWing,
	navigateToRoom,
	type OnDemandConfig,
	type OnDemandResult,
	type WingStats,
	type WingExploration,
	type RoomNavigation,
} from "./layer2";

export {
	search,
	searchWithEmbedding,
	findSimilarMemories,
	discoverConcepts,
	suggestContext,
	type DeepSearchConfig,
	type DeepSearchResult,
} from "./layer3";

/**
 * Wake-up context containing all layers.
 *
 * This is the complete context loaded during the wake-up sequence.
 */
export interface WakeUpContext {
	/** Layer 0: Identity content */
	identity: string;
	/** Layer 1: Essential story */
	essentialStory: string;
	/** Current timestamp */
	generatedAt: Date;
	/** Wing list for navigation */
	availableWings: string[];
}

/**
 * Memory retrieval request.
 */
export interface RetrievalRequest {
	/** Query text (used for L3) */
	query?: string;
	/** Wing filter (L2/L3) */
	wing?: string;
	/** Room filter (L2/L3) */
	room?: string;
	/** Include L0 */
	includeIdentity?: boolean;
	/** Include L1 */
	includeEssential?: boolean;
	/** Use L2 retrieval */
	useOnDemand?: boolean;
	/** Use L3 deep search */
	useDeepSearch?: boolean;
	/** Limit for results */
	limit?: number;
}

/**
 * Memory retrieval result.
 */
export interface RetrievalResult {
	/** Retrieved content */
	content: string;
	/** Which layers were used */
	layersUsed: ("l0" | "l1" | "l2" | "l3")[];
	/** Source memories (if applicable) */
	memories?: Array<{ text: string; wing: string; room: string; score?: number }>;
	/** Generation timestamp */
	generatedAt: Date;
	/** Token estimate */
	estimatedTokens: number;
}

/**
 * MemoryStack — Unified access to all memory layers.
 *
 * Provides a single interface for the wake-up sequence and
 * various retrieval modes.
 */
export class MemoryStack {
	/**
	 * Perform the wake-up sequence.
	 *
	 * Loads L0 (identity) and L1 (essential story) for immediate context.
	 * This is called at the start of each session.
	 */
	async wakeUp(): Promise<WakeUpContext> {
		const [identity, essentialStory, wings] = await Promise.all([
			import("./layer0").then(m => m.loadIdentity()),
			import("./layer1").then(m => m.getEssentialStory()),
			import("./layer2").then(m => m.listWings()),
		]);

		return {
			identity,
			essentialStory,
			generatedAt: new Date(),
			availableWings: wings,
		};
	}

	/**
	 * Retrieve context based on request.
	 *
	 * @param request - What to retrieve.
	 * @returns Retrieved context.
	 */
	async retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
		const parts: string[] = [];
		const layersUsed: ("l0" | "l1" | "l2" | "l3")[] = [];

		// Layer 0: Identity
		if (request.includeIdentity) {
			const identity = await import("./layer0").then(m => m.loadIdentity());
			if (identity) {
				parts.push(`[IDENTITY]\n${identity}`);
				layersUsed.push("l0");
			}
		}

		// Layer 1: Essential Story
		if (request.includeEssential) {
			const story = await import("./layer1").then(m => m.getEssentialStory());
			if (story) {
				parts.push(`[ESSENTIAL]\n${story}`);
				layersUsed.push("l1");
			}
		}

		// Layer 2: On-Demand
		if (request.useOnDemand && request.wing) {
			const { retrieveByLocation } = await import("./layer2");
			const result = await retrieveByLocation({
				wing: request.wing,
				room: request.room,
				limit: request.limit ?? 20,
			});

			if (result.memories.length > 0) {
				const memoriesText = result.memories.map(m => `[${m.wing}/${m.room}] ${m.text}`).join("\n");
				parts.push(`[${request.wing.toUpperCase()}]\n${memoriesText}`);
				layersUsed.push("l2");
			}
		}

		// Layer 3: Deep Search
		if (request.useDeepSearch && request.query) {
			const { search } = await import("./layer3");
			const result = await search(request.query, {
				limit: request.limit ?? 10,
				wing: request.wing,
				room: request.room,
			});

			if (result.matches.length > 0) {
				const memoriesText = result.matches
					.map(m => `[${m.memory.wing}/${m.memory.room}] ${m.memory.text}`)
					.join("\n");
				parts.push(`[SEARCH: "${request.query}"]\n${memoriesText}`);
				layersUsed.push("l3");
			}
		}

		const content = parts.join("\n\n");
		const estimatedTokens = Math.ceil(content.length / 4);

		return {
			content,
			layersUsed,
			memories: parts.flatMap(p => {
				const matches: Array<{ text: string; wing: string; room: string; score?: number }> = [];
				const regex = /\[([^\]]+)\/([^\]]+)\] (.+)/g;
				let match: RegExpExecArray | null;
				while ((match = regex.exec(p)) !== null) {
					matches.push({
						wing: match[1],
						room: match[2],
						text: match[3],
					});
				}
				return matches;
			}),
			generatedAt: new Date(),
			estimatedTokens,
		};
	}

	/**
	 * Quick search across all memories.
	 *
	 * @param query - Search query.
	 * @param options - Search options.
	 * @returns Search results.
	 */
	async quickSearch(query: string, options: { limit?: number; wing?: string } = {}) {
		const { search } = await import("./layer3");
		return search(query, options);
	}

	/**
	 * Get palace overview.
	 *
	 * Returns statistics and structure of the memory palace.
	 */
	async getOverview(): Promise<PalaceOverview> {
		const [wings, { getDb }] = await Promise.all([import("./layer2").then(m => m.listWings()), import("../db")]);

		const db = getDb();
		const totalMemories = await db.query<Array<{ count: number }>>("SELECT count() AS count FROM memory GROUP ALL;");

		const wingStats = await Promise.all(
			wings.map(async wing => {
				const { getWingStats } = await import("./layer2");
				return getWingStats(wing);
			}),
		);

		return {
			totalMemories: totalMemories?.[0]?.count ?? 0,
			wingCount: wings.length,
			wings: wingStats,
			generatedAt: new Date(),
		};
	}
}

/** Palace overview data */
export interface PalaceOverview {
	/** Total memory count */
	totalMemories: number;
	/** Number of wings */
	wingCount: number;
	/** Per-wing statistics */
	wings: Array<{
		wing: string;
		totalMemories: number;
		roomCount: number;
		rooms: string[];
		sources: Array<{ source: string; count: number }>;
		oldestMemory: Date | null;
		newestMemory: Date | null;
	}>;
	/** When this overview was generated */
	generatedAt: Date;
}

/** Default memory stack instance */
let defaultStack: MemoryStack | null = null;

/**
 * Get the default memory stack instance.
 */
export function getMemoryStack(): MemoryStack {
	if (!defaultStack) {
		defaultStack = new MemoryStack();
	}
	return defaultStack;
}
