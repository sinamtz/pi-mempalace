/**
 * Layer 2: On-Demand Retrieval — Wing/room filtered access.
 *
 * The on-demand layer provides filtered access to memories based on
 * spatial organization (wings and rooms). This is used for context-
 * specific queries where the caller knows which area of the palace
 * to explore.
 *
 * Unlike Layer 3 (deep search), this layer:
 * - Does not use vector similarity
 * - Returns all matching memories within limits
 * - Is faster for metadata-based filtering
 */

import { getDb } from "../broker";
import { listMemories } from "../memory";
import type { Memory } from "../types";
import { logger } from "../logger";

/** Configuration for on-demand retrieval */
export interface OnDemandConfig {
	/** Wing to filter by */
	wing?: string;
	/** Room to filter by */
	room?: string;
	/** Maximum memories to return (default: 50) */
	limit?: number;
	/** Source to filter by */
	source?: string;
	/** Return memories newer than this date */
	since?: Date;
	/** Return memories older than this date */
	until?: Date;
}

/** Result of an on-demand retrieval query */
export interface OnDemandResult {
	/** Matching memories */
	memories: Memory[];
	/** Total count of matches (may exceed limit) */
	totalCount: number;
	/** Which filters were applied */
	filters: {
		wing?: string;
		room?: string;
		source?: string;
		since?: Date;
		until?: Date;
	};
}

/**
 * Retrieve memories by wing and/or room.
 *
 * This is the primary interface for Layer 2 access. It returns
 * memories matching the specified spatial filters.
 *
 * @param config - Filter configuration.
 * @returns Matching memories with metadata.
 */
export async function retrieveByLocation(config: OnDemandConfig = {}): Promise<OnDemandResult> {
	const { wing, room, limit = 50, source, since, until } = config;

	const memories = await listMemories({ wing, room, limit: limit * 2 }); // Fetch extra for filtering

	// Apply additional filters
	let filtered = memories;

	if (source) {
		filtered = filtered.filter(m => m.source === source);
	}

	if (since) {
		const sinceTime = since.getTime();
		filtered = filtered.filter(m => m.timestamp.getTime() >= sinceTime);
	}

	if (until) {
		const untilTime = until.getTime();
		filtered = filtered.filter(m => m.timestamp.getTime() <= untilTime);
	}

	// Apply limit
	const limited = filtered.slice(0, limit);

	logger.debug("On-demand retrieval", {
		requested: config,
		returned: limited.length,
		totalFiltered: filtered.length,
	});

	return {
		memories: limited,
		totalCount: filtered.length,
		filters: {
			wing,
			room,
			source,
			since,
			until,
		},
	};
}

/**
 * Get all available wings (unique wing names).
 *
 * @returns Array of wing names, sorted alphabetically.
 */
export async function listWings(): Promise<string[]> {
	const db = getDb();

	const results = await db.query<Array<{ wing: string }>>(`SELECT wing FROM memory GROUP BY wing ORDER BY wing ASC;`);

	return (results ?? []).map(r => r.wing).filter(Boolean);
}

/**
 * Get all rooms in a specific wing.
 *
 * @param wing - The wing to list rooms for.
 * @returns Array of room names, sorted alphabetically.
 */
export async function listRoomsInWing(wing: string): Promise<string[]> {
	const db = getDb();

	const results = await db.query<Array<{ room: string }>>(
		`SELECT room FROM memory WHERE wing = $wing GROUP BY room ORDER BY room ASC;`,
		{ wing },
	);

	return (results ?? []).map(r => r.room).filter(Boolean);
}

/**
 * Get memory statistics for a wing.
 *
 * @param wing - The wing to analyze.
 * @returns Statistics about the wing's contents.
 */
export async function getWingStats(wing: string): Promise<WingStats> {
	const db = getDb();

	const results = await db.query<
		Array<{
			count: number;
			oldest: Date | string;
			newest: Date | string;
			sources: Array<{ source: string; count: number }>;
		}>
	>(
		`SELECT
			count() AS count,
			array::len((SELECT * FROM memory WHERE wing = $wing)) AS total,
			time::min(timestamp) AS oldest,
			time::max(timestamp) AS newest
		FROM memory
		WHERE wing = $wing
		GROUP ALL;`,
		{ wing },
	);

	const rooms = await listRoomsInWing(wing);

	const sourceResults = await db.query<Array<{ source: string; count: number }>>(
		`SELECT source, count() AS count FROM memory WHERE wing = $wing GROUP BY source ORDER BY count DESC;`,
		{ wing },
	);

	const first = results?.[0];

	return {
		wing,
		totalMemories: first?.count ?? 0,
		roomCount: rooms.length,
		rooms,
		sources: (sourceResults ?? []).map(s => ({
			source: s.source,
			count: s.count,
		})),
		oldestMemory: first?.oldest ? new Date(first.oldest) : null,
		newestMemory: first?.newest ? new Date(first.newest) : null,
	};
}

/** Statistics for a wing */
export interface WingStats {
	/** Wing name */
	wing: string;
	/** Total memory count */
	totalMemories: number;
	/** Number of distinct rooms */
	roomCount: number;
	/** Room names in this wing */
	rooms: string[];
	/** Memory counts by source */
	sources: Array<{ source: string; count: number }>;
	/** Oldest memory in this wing */
	oldestMemory: Date | null;
	/** Newest memory in this wing */
	newestMemory: Date | null;
}

/**
 * Explore a wing's contents.
 *
 * Returns a summary of the wing's structure and recent memories.
 *
 * @param wing - The wing to explore.
 * @param options - Options for exploration.
 * @returns Wing exploration result.
 */
export async function exploreWing(wing: string, options: { recentLimit?: number } = {}): Promise<WingExploration> {
	const { recentLimit = 10 } = options;

	const [stats, recent] = await Promise.all([getWingStats(wing), listMemories({ wing, limit: recentLimit })]);

	return {
		stats,
		recentMemories: recent,
	};
}

/** Result of wing exploration */
export interface WingExploration {
	/** Wing statistics */
	stats: WingStats;
	/** Recent memories from this wing */
	recentMemories: Memory[];
}

/**
 * Navigate to a specific room.
 *
 * Returns all memories in a room, grouped by recency.
 *
 * @param wing - The wing containing the room.
 * @param room - The room to navigate to.
 * @param options - Navigation options.
 * @returns Room navigation result.
 */
export async function navigateToRoom(
	wing: string,
	room: string,
	options: { limit?: number; groupByRecency?: boolean } = {},
): Promise<RoomNavigation> {
	const { limit = 100, groupByRecency = true } = options;

	const memories = await listMemories({ wing, room, limit });

	// Group by recency buckets
	const now = Date.now();
	const dayMs = 86400000;

	const groups = {
		today: [] as Memory[],
		thisWeek: [] as Memory[],
		thisMonth: [] as Memory[],
		older: [] as Memory[],
	};

	for (const memory of memories) {
		const age = now - memory.timestamp.getTime();

		if (age < dayMs) {
			groups.today.push(memory);
		} else if (age < dayMs * 7) {
			groups.thisWeek.push(memory);
		} else if (age < dayMs * 30) {
			groups.thisMonth.push(memory);
		} else {
			groups.older.push(memory);
		}
	}

	return {
		wing,
		room,
		memories,
		groups: groupByRecency ? groups : undefined,
		totalCount: memories.length,
	};
}

/** Result of room navigation */
export interface RoomNavigation {
	/** Wing containing the room */
	wing: string;
	/** Room name */
	room: string;
	/** All memories in the room */
	memories: Memory[];
	/** Memories grouped by recency (if enabled) */
	groups?: {
		today: Memory[];
		thisWeek: Memory[];
		thisMonth: Memory[];
		older: Memory[];
	};
	/** Total memory count */
	totalCount: number;
}
