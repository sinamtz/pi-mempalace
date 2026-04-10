/**
 * Palace Protocol — Structured memory interactions.
 *
 * The palace protocol defines how the agent interacts with the memory palace:
 * - Wake-up sequence (L0 + L1 loading)
 * - Memory attribution in responses
 * - Context windows and token budgets
 * - Structured query patterns
 */

import { getMemoryStack, loadIdentity } from "../layers";
import type { WakeUpContext } from "../layers";
import { search } from "../layers";
import { logger } from "../logger";

/** Protocol version */
export const PROTOCOL_VERSION = "1.0.0";

/** Token budget for different contexts */
export interface TokenBudget {
	/** Maximum tokens for L0 identity */
	identity: number;
	/** Maximum tokens for L1 essential story */
	essential: number;
	/** Maximum tokens for L2 on-demand */
	onDemand: number;
	/** Maximum tokens for L3 deep search */
	deepSearch: number;
	/** Maximum total context */
	total: number;
}

/** Default token budget (configurable) */
export const DEFAULT_TOKEN_BUDGET: TokenBudget = {
	identity: 200,
	essential: 600,
	onDemand: 400,
	deepSearch: 300,
	total: 1500,
};

/** Memory attribution metadata */
export interface MemoryAttribution {
	/** Memory text */
	text: string;
	/** Source wing */
	wing: string;
	/** Source room */
	room: string;
	/** Relevance score (if from search) */
	score?: number;
	/** When this memory was created */
	timestamp: Date;
	/** Memory source */
	source: string;
}

/** Response with memory context */
export interface MemoryContextResponse {
	/** The generated response text */
	response: string;
	/** Memories used in generating response */
	attributions: MemoryAttribution[];
	/** Token count used */
	tokenCount: number;
	/** Which layers were accessed */
	layersUsed: string[];
	/** Protocol version */
	protocolVersion: string;
}

/** Protocol configuration */
export interface ProtocolConfig {
	/** Token budget settings */
	budget: TokenBudget;
	/** Include attributions in response */
	includeAttributions: boolean;
	/** Attribution style */
	attributionStyle: "inline" | "footer" | "none";
	/** Wake-up cache duration in ms */
	wakeUpCacheDuration: number;
}

/** Default protocol configuration */
const DEFAULT_PROTOCOL_CONFIG: ProtocolConfig = {
	budget: DEFAULT_TOKEN_BUDGET,
	includeAttributions: true,
	attributionStyle: "footer",
	wakeUpCacheDuration: 300000, // 5 minutes
};

/** Cached wake-up context */
let cachedWakeUp: WakeUpContext | null = null;
let wakeUpCacheTime = 0;

/**
 * Perform the wake-up sequence.
 *
 * Loads L0 (identity) and L1 (essential story) into context.
 * Results are cached according to cache duration.
 *
 * @param config - Protocol configuration.
 * @returns Wake-up context.
 */
export async function wakeUp(config: Partial<ProtocolConfig> = {}): Promise<WakeUpContext> {
	const cfg = { ...DEFAULT_PROTOCOL_CONFIG, ...config };
	const now = Date.now();

	// Check cache validity
	if (cachedWakeUp && now - wakeUpCacheTime < cfg.wakeUpCacheDuration) {
		logger.debug("Wake-up context served from cache");
		return cachedWakeUp;
	}

	// Fresh wake-up
	logger.debug("Performing wake-up sequence");
	const stack = getMemoryStack();
	cachedWakeUp = await stack.wakeUp();
	wakeUpCacheTime = now;

	logger.info("Wake-up sequence complete", {
		identityLength: cachedWakeUp.identity.length,
		essentialLength: cachedWakeUp.essentialStory.length,
		wingCount: cachedWakeUp.availableWings.length,
	});

	return cachedWakeUp;
}

/**
 * Build context string for a prompt.
 *
 * Constructs the full context string with all requested layers,
 * respecting token budgets.
 *
 * @param request - What to include in context.
 * @param config - Protocol configuration.
 * @returns Context string with attributions.
 */
export async function buildContext(
	request: {
		query?: string;
		wing?: string;
		room?: string;
		layers?: ("l0" | "l1" | "l2" | "l3")[];
		searchQuery?: string;
	},
	config: Partial<ProtocolConfig> = {},
): Promise<{
	context: string;
	attributions: MemoryAttribution[];
	tokenCount: number;
}> {
	const cfg = { ...DEFAULT_PROTOCOL_CONFIG, ...config };
	const layers = request.layers ?? ["l0", "l1"];

	const parts: string[] = [];
	const attributions: MemoryAttribution[] = [];
	let totalTokens = 0;

	// Layer 0: Identity
	if (layers.includes("l0")) {
		const identity = await loadIdentity();
		if (identity) {
			const truncated = truncateToTokens(identity, cfg.budget.identity);
			parts.push(`## Identity\n${truncated}`);
			totalTokens += Math.ceil(truncated.length / 4);

			attributions.push({
				text: truncated,
				wing: "identity",
				room: "self",
				timestamp: new Date(),
				source: "identity.txt",
			});
		}
	}

	// Layer 1: Essential Story
	if (layers.includes("l1")) {
		const { getEssentialStory } = await import("../layers/layer1");
		const story = await getEssentialStory();
		if (story) {
			const truncated = truncateToTokens(story, cfg.budget.essential);
			parts.push(`## Essential Memory\n${truncated}`);
			totalTokens += Math.ceil(truncated.length / 4);
		}
	}

	// Layer 2: On-Demand
	if (layers.includes("l2") && request.wing) {
		const { retrieveByLocation } = await import("../layers/layer2");
		const result = await retrieveByLocation({
			wing: request.wing,
			room: request.room,
			limit: Math.floor(cfg.budget.onDemand / 50),
		});

		if (result.memories.length > 0) {
			const memoriesText = result.memories
				.slice(0, 10)
				.map(m => `[${m.wing}/${m.room}] ${m.text}`)
				.join("\n");

			parts.push(`## ${request.wing.toUpperCase()}\n${memoriesText}`);
			totalTokens += Math.ceil(memoriesText.length / 4);

			for (const m of result.memories) {
				attributions.push({
					text: m.text,
					wing: m.wing,
					room: m.room,
					timestamp: m.timestamp,
					source: m.source,
				});
			}
		}
	}

	// Layer 3: Deep Search
	if (layers.includes("l3") && request.searchQuery) {
		const result = await search(request.searchQuery, {
			limit: Math.floor(cfg.budget.deepSearch / 50),
			wing: request.wing,
		});

		if (result.matches.length > 0) {
			const memoriesText = result.matches
				.map(m => `[${m.memory.wing}/${m.memory.room}] ${m.memory.text}`)
				.join("\n");

			parts.push(`## Related Memories\n${memoriesText}`);
			totalTokens += Math.ceil(memoriesText.length / 4);

			for (const m of result.matches) {
				attributions.push({
					text: m.memory.text,
					wing: m.memory.wing,
					room: m.memory.room,
					score: m.score,
					timestamp: m.memory.timestamp,
					source: m.memory.source,
				});
			}
		}
	}

	// Truncate to total budget
	let context = parts.join("\n\n");
	context = truncateToTokens(context, cfg.budget.total);
	totalTokens = Math.ceil(context.length / 4);

	return {
		context,
		attributions,
		tokenCount: totalTokens,
	};
}

/**
 * Format attributions for response.
 */
export function formatAttributions(attributions: MemoryAttribution[], style: "inline" | "footer" | "none"): string {
	if (style === "none" || attributions.length === 0) {
		return "";
	}

	if (style === "inline") {
		return attributions.map(a => `(${a.wing}/${a.room}: ${a.text.slice(0, 50)}...)`).join(" ");
	}

	// Footer style
	const lines = ["", "---", "Memory attributions:"];

	const byWing = new Map<string, MemoryAttribution[]>();
	for (const attr of attributions) {
		const existing = byWing.get(attr.wing) ?? [];
		existing.push(attr);
		byWing.set(attr.wing, existing);
	}

	for (const [wing, attrs] of byWing) {
		lines.push(`\n**${wing}**:`);
		for (const attr of attrs.slice(0, 3)) {
			const score = attr.score ? ` (${(attr.score * 100).toFixed(0)}%)` : "";
			const preview = attr.text.slice(0, 80).replace(/\n/g, " ");
			lines.push(`  - ${preview}...${score}`);
		}
	}

	return lines.join("\n");
}

/**
 * Query the memory palace with a structured request.
 *
 * This is the main interface for agent queries.
 *
 * @param query - The query text.
 * @param options - Query options.
 * @returns Query result with context.
 */
export async function queryPalace(
	query: string,
	options: {
		wing?: string;
		layers?: ("l0" | "l1" | "l2" | "l3")[];
		maxTokens?: number;
		includeAttributions?: boolean;
	} = {},
): Promise<MemoryContextResponse> {
	const config: ProtocolConfig = {
		...DEFAULT_PROTOCOL_CONFIG,
		budget: {
			...DEFAULT_PROTOCOL_CONFIG.budget,
			total: options.maxTokens ?? DEFAULT_PROTOCOL_CONFIG.budget.total,
		},
		includeAttributions: options.includeAttributions ?? true,
	};

	// Build context
	const { context, attributions, tokenCount } = await buildContext(
		{
			searchQuery: query,
			wing: options.wing,
			layers: options.layers ?? ["l0", "l1", "l3"],
		},
		config,
	);

	const layersUsed = options.layers ?? ["l0", "l1", "l3"];

	return {
		response: context,
		attributions,
		tokenCount,
		layersUsed,
		protocolVersion: PROTOCOL_VERSION,
	};
}

/**
 * Clear wake-up cache.
 */
export function clearWakeUpCache(): void {
	cachedWakeUp = null;
	wakeUpCacheTime = 0;
	logger.debug("Wake-up cache cleared");
}

/**
 * Truncate text to fit within token budget.
 */
function truncateToTokens(text: string, maxTokens: number): string {
	const maxChars = maxTokens * 4; // ~4 chars per token

	if (text.length <= maxChars) {
		return text;
	}

	// Find a good break point
	const truncated = text.slice(0, maxChars);
	const lastNewline = truncated.lastIndexOf("\n");
	const lastSentence = truncated.lastIndexOf(". ");

	const breakPoint =
		lastNewline > maxChars * 0.8 ? lastNewline : lastSentence > maxChars * 0.7 ? lastSentence + 1 : maxChars;

	return `${text.slice(0, breakPoint).trim()}...`;
}

/**
 * Query pattern: Quick recall.
 *
 * Fast lookup for a specific fact or memory.
 */
export async function quickRecall(query: string): Promise<MemoryAttribution[]> {
	const result = await search(query, { limit: 3, minScore: 0.5 });

	return result.matches.map(m => ({
		text: m.memory.text,
		wing: m.memory.wing,
		room: m.memory.room,
		score: m.score,
		timestamp: m.memory.timestamp,
		source: m.memory.source,
	}));
}

/**
 * Query pattern: Explore wing.
 *
 * Get overview of a wing's contents.
 */
export async function explorePalace(
	wing: string,
	options: { limit?: number } = {},
): Promise<{
	overview: string;
	memories: MemoryAttribution[];
	tokenCount: number;
}> {
	const { exploreWing } = await import("../layers/layer2");
	const { stats: wingStats, recentMemories } = await exploreWing(wing, {
		recentLimit: options.limit ?? 10,
	});

	const overview = `## ${wing.toUpperCase()}

Statistics:
- Total memories: ${wingStats.totalMemories}
- Rooms: ${wingStats.rooms.join(", ") || "none"}
- Active sources: ${wingStats.sources.map((s: { source: string; count: number }) => `${s.source} (${s.count})`).join(", ") || "none"}
- Date range: ${wingStats.oldestMemory?.toISOString().split("T")[0] ?? "unknown"} to ${wingStats.newestMemory?.toISOString().split("T")[0] ?? "unknown"}
`;

	const memories = recentMemories.map(m => ({
		text: m.text,
		wing: m.wing,
		room: m.room,
		timestamp: m.timestamp,
		source: m.source,
	}));

	return {
		overview,
		memories,
		tokenCount: Math.ceil((overview + memories.map(m => m.text).join("\n")).length / 4),
	};
}

/**
 * Query pattern: Context injection.
 *
 * Inject relevant memories into the current context window.
 */
export async function injectContext(
	query: string,
	_currentContext: string,
	maxTokens: number,
): Promise<{
	injectedContext: string;
	addedTokens: number;
	matchingMemories: MemoryAttribution[];
}> {
	// Search for relevant memories
	const result = await search(query, { limit: 10, minScore: 0.3 });

	// Build injection string
	const parts: string[] = [];
	let addedTokens = 0;

	for (const match of result.matches) {
		const memoryText = `[${match.memory.wing}/${match.memory.room}] ${match.memory.text}`;
		const tokens = Math.ceil(memoryText.length / 4);

		if (addedTokens + tokens > maxTokens - 20) break; // Leave room for markers

		parts.push(memoryText);
		addedTokens += tokens;
	}

	const injectedContext =
		parts.length > 0 ? `\n\n[Relevant memories from palace]\n${parts.join("\n")}\n[/Relevant memories]\n\n` : "";

	const matchingMemories = result.matches.slice(0, parts.length).map(m => ({
		text: m.memory.text,
		wing: m.memory.wing,
		room: m.memory.room,
		score: m.score,
		timestamp: m.memory.timestamp,
		source: m.memory.source,
	}));

	return {
		injectedContext,
		addedTokens,
		matchingMemories,
	};
}

/**
 * Log protocol event.
 */
function _logProtocolEvent(event: string, details: Record<string, unknown>): void {
	logger.debug(`Protocol: ${event}`, {
		version: PROTOCOL_VERSION,
		...details,
	});
}

/**
 * Get protocol status.
 */
export function getProtocolStatus(): {
	version: string;
	cacheValid: boolean;
	config: ProtocolConfig;
} {
	const cacheValid =
		cachedWakeUp !== null && Date.now() - wakeUpCacheTime < DEFAULT_PROTOCOL_CONFIG.wakeUpCacheDuration;

	return {
		version: PROTOCOL_VERSION,
		cacheValid,
		config: DEFAULT_PROTOCOL_CONFIG,
	};
}
