/**
 * Palace Navigation Graph for MemPalace.
 *
 * Builds and traverses the spatial navigation graph from room metadata.
 * Supports BFS traversal for room discovery and tunnel detection
 * for rooms that span multiple wings.
 */

import { getDb } from "../db";
import { logger } from "../logger";
import type { PalaceNode, TraversalOptions } from "./types";

/** Memory table reference */
const _MEMORY_TABLE = "memory";

/** Memory record for room statistics */
interface MemoryRecord {
	id: string;
	wing: string;
	room: string;
	timestamp: Date | string;
	text: string;
}

/**
 * Build the palace navigation graph from memory metadata.
 *
 * Analyzes all memories to build a graph of rooms with their
 * connections based on shared themes and adjacency.
 *
 * @returns Map of room IDs to PalaceNodes.
 */
export async function buildPalaceGraph(): Promise<Map<string, PalaceNode>> {
	const db = getDb();
	const graph = new Map<string, PalaceNode>();

	logger.debug("Building palace navigation graph");

	// Get all unique wing/room combinations with their memory counts
	const roomStats = await db.query<
		Array<{
			wing: string;
			room: string;
			memory_count: number;
			last_timestamp: Date | string;
		}>
	>(
		`SELECT wing, room, count() as memory_count, math::max(timestamp) as last_timestamp
		 FROM memory
		 GROUP BY wing, room;`,
	);

	if (!roomStats || roomStats.length === 0) {
		logger.debug("No memories found, empty graph");
		return graph;
	}

	// Build nodes for each room
	for (const stat of roomStats) {
		const nodeId = `${stat.wing}:${stat.room}`;

		graph.set(nodeId, {
			id: nodeId,
			wing: stat.wing,
			room: stat.room,
			connections: new Map(),
			metadata: {
				wing: stat.wing,
				room: stat.room,
				memoryCount: stat.memory_count,
				adjacentRooms: [],
				tunnelRooms: [],
				themes: [],
				lastActivity: stat.last_timestamp instanceof Date ? stat.last_timestamp : new Date(stat.last_timestamp),
			},
		});
	}

	// Build connections based on room proximity and content similarity
	await buildConnections(graph);

	// Extract themes from room contents
	await extractRoomThemes(graph);

	logger.info("Palace graph built", {
		totalNodes: graph.size,
		wings: new Set(Array.from(graph.values()).map(n => n.wing)).size,
	});

	return graph;
}

/**
 * Build connections between rooms based on various heuristics.
 */
async function buildConnections(graph: Map<string, PalaceNode>): Promise<void> {
	// Group rooms by wing
	const byWing = new Map<string, PalaceNode[]>();
	for (const node of graph.values()) {
		const existing = byWing.get(node.wing) || [];
		existing.push(node);
		byWing.set(node.wing, existing);
	}

	// Within-wing connections: rooms in the same wing are "adjacent"
	for (const [, wingRooms] of byWing) {
		for (let i = 0; i < wingRooms.length; i++) {
			for (let j = i + 1; j < wingRooms.length; j++) {
				const roomA = wingRooms[i];
				const roomB = wingRooms[j];

				// Lexicographically adjacent rooms are connected
				if (isLexicographicallyAdjacent(roomA.room, roomB.room)) {
					roomA.connections.set(roomB.id, { nodeId: roomB.id, type: "adjacent" });
					roomB.connections.set(roomA.id, { nodeId: roomA.id, type: "adjacent" });
				}
			}
		}
	}

	// Cross-wing connections (tunnels): rooms with similar themes or names
	const allRooms = Array.from(graph.values());

	for (let i = 0; i < allRooms.length; i++) {
		for (let j = i + 1; j < allRooms.length; j++) {
			const roomA = allRooms[i];
			const roomB = allRooms[j];

			// Skip same-wing rooms
			if (roomA.wing === roomB.wing) {
				continue;
			}

			// Check for tunnel conditions
			if (isTunnelCandidate(roomA.room, roomB.room)) {
				roomA.connections.set(roomB.id, { nodeId: roomB.id, type: "tunnel" });
				roomB.connections.set(roomA.id, { nodeId: roomA.id, type: "tunnel" });
			}
		}
	}
}

/**
 * Check if two room names are lexicographically adjacent.
 * Rooms like "room-1" and "room-2" are adjacent.
 */
function isLexicographicallyAdjacent(roomA: string, roomB: string): boolean {
	// Extract numeric suffix
	const numA = extractRoomNumber(roomA);
	const numB = extractRoomNumber(roomB);

	// If both have numeric suffixes and they're consecutive
	if (numA !== null && numB !== null) {
		return Math.abs(numA - numB) <= 1;
	}

	// Check for common prefix with numeric suffix
	const prefixA = roomA.replace(/\d+$/, "");
	const prefixB = roomB.replace(/\d+$/, "");

	if (prefixA === prefixB && prefixA.length > 2) {
		const nA = numA ?? 0;
		const nB = numB ?? 0;
		return Math.abs(nA - nB) <= 1;
	}

	return false;
}

/**
 * Extract numeric suffix from room name.
 */
function extractRoomNumber(room: string): number | null {
	const match = room.match(/(\d+)$/);
	return match ? parseInt(match[1], 10) : null;
}

/**
 * Check if two rooms from different wings could be tunneled.
 *
 * Tunnels are created when:
 * - Room names share significant commonality
 * - Rooms have similar content themes
 */
function isTunnelCandidate(roomA: string, roomB: string): boolean {
	const normA = roomA.toLowerCase().replace(/[-_]/g, "");
	const normB = roomB.toLowerCase().replace(/[-_]/g, "");

	// Exact match (ignoring case and separators)
	if (normA === normB) {
		return true;
	}

	// One contains the other
	if (normA.includes(normB) || normB.includes(normA)) {
		return true;
	}

	// Levenshtein distance check for similar names
	const distance = levenshteinDistance(normA, normB);
	const maxLen = Math.max(normA.length, normB.length);

	// Allow 20% edit distance
	if (maxLen > 3 && distance / maxLen < 0.2) {
		return true;
	}

	return false;
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshteinDistance(a: string, b: string): number {
	if (a.length === 0) return b.length;
	if (b.length === 0) return a.length;

	const matrix: number[][] = [];

	for (let i = 0; i <= b.length; i++) {
		matrix[i] = [i];
	}

	for (let j = 0; j <= a.length; j++) {
		matrix[0][j] = j;
	}

	for (let i = 1; i <= b.length; i++) {
		for (let j = 1; j <= a.length; j++) {
			if (b.charAt(i - 1) === a.charAt(j - 1)) {
				matrix[i][j] = matrix[i - 1][j - 1];
			} else {
				matrix[i][j] = Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
			}
		}
	}

	return matrix[b.length][a.length];
}

/**
 * Extract themes from room contents for better organization.
 */
async function extractRoomThemes(graph: Map<string, PalaceNode>): Promise<void> {
	const db = getDb();

	for (const node of graph.values()) {
		// Get sample texts from this room
		const memories = await db.query<MemoryRecord[]>(
			`SELECT text FROM memory WHERE wing = $wing AND room = $room LIMIT 10;`,
			{ wing: node.wing, room: node.room },
		);

		if (!memories || memories.length === 0) {
			continue;
		}

		// Extract common words/phrases
		const textContent = memories.map(m => m.text).join(" ");
		const themes = extractThemesFromText(textContent);

		node.metadata.themes = themes;
	}
}

/**
 * Extract themes from text content.
 *
 * Uses simple frequency analysis and pattern matching.
 */
function extractThemesFromText(text: string): string[] {
	// Common stopwords to exclude
	const stopwords = new Set([
		"the",
		"a",
		"an",
		"and",
		"or",
		"but",
		"in",
		"on",
		"at",
		"to",
		"for",
		"of",
		"with",
		"by",
		"from",
		"as",
		"is",
		"was",
		"are",
		"were",
		"been",
		"be",
		"have",
		"has",
		"had",
		"do",
		"does",
		"did",
		"this",
		"that",
		"it",
	]);

	// Extract words (3+ chars, not stopwords)
	const words = text
		.toLowerCase()
		.replace(/[^\w\s]/g, " ")
		.split(/\s+/)
		.filter(w => w.length >= 3 && !stopwords.has(w));

	// Count frequency
	const freq = new Map<string, number>();
	for (const word of words) {
		freq.set(word, (freq.get(word) || 0) + 1);
	}

	// Get top themes (most frequent significant words)
	const sorted = Array.from(freq.entries())
		.sort((a, b) => b[1] - a[1])
		.slice(0, 5)
		.map(([word]) => word);

	return sorted;
}

/**
 * Traverse the palace graph starting from a room.
 *
 * Uses BFS to discover connected rooms.
 *
 * @param start - Starting room ID (wing:room format).
 * @param options - Traversal options.
 * @returns Array of visited rooms in traversal order.
 */
export async function traverseRooms(start: string, options: TraversalOptions = {}): Promise<PalaceNode[]> {
	const { maxDepth = 10, edgeTypes = ["all"] } = options;
	// Build graph if not provided
	const graph = await buildPalaceGraph();

	const startNode = graph.get(start);
	if (!startNode) {
		logger.warn("Start room not found", { start });
		return [];
	}

	const visited = new Set<string>();
	const queue: Array<{ node: PalaceNode; depth: number }> = [{ node: startNode, depth: 0 }];
	const result: PalaceNode[] = [];

	while (queue.length > 0) {
		const { node, depth } = queue.shift()!;

		if (visited.has(node.id)) {
			continue;
		}
		visited.add(node.id);
		result.push(node);

		if (depth >= maxDepth) {
			continue;
		}

		// Explore connections
		for (const [, connection] of node.connections) {
			if (visited.has(connection.nodeId)) {
				continue;
			}

			// Filter by edge type
			if (!edgeTypes.includes("all") && !edgeTypes.includes(connection.type)) {
				continue;
			}

			const connectedNode = graph.get(connection.nodeId);
			if (connectedNode) {
				queue.push({ node: connectedNode, depth: depth + 1 });
			}
		}
	}

	logger.debug("Room traversal complete", {
		start,
		visitedCount: result.length,
		maxDepth,
	});

	return result;
}

/**
 * Find the shortest path between two rooms.
 *
 * @param from - Starting room ID.
 * @param to - Target room ID.
 * @returns Array of room IDs forming the path, or empty if no path.
 */
export async function findPath(from: string, to: string): Promise<string[]> {
	const graph = await buildPalaceGraph();

	const fromNode = graph.get(from);
	const toNode = graph.get(to);

	if (!fromNode || !toNode) {
		return [];
	}

	// BFS for shortest path
	const visited = new Set<string>();
	const queue: Array<{ nodeId: string; path: string[] }> = [{ nodeId: from, path: [from] }];

	while (queue.length > 0) {
		const { nodeId, path } = queue.shift()!;

		if (nodeId === to) {
			return path;
		}

		if (visited.has(nodeId)) {
			continue;
		}
		visited.add(nodeId);

		const node = graph.get(nodeId);
		if (!node) {
			continue;
		}

		for (const [connectedId] of node.connections) {
			if (!visited.has(connectedId)) {
				queue.push({ nodeId: connectedId, path: [...path, connectedId] });
			}
		}
	}

	return [];
}

/**
 * Get all tunnel connections in the palace.
 *
 * Tunnels are cross-wing connections that allow navigation
 * between different areas of the palace.
 *
 * @returns Array of tunnel connections.
 */
export async function getTunnels(): Promise<Array<{ from: string; to: string; distance: number }>> {
	const graph = await buildPalaceGraph();
	const tunnels: Array<{ from: string; to: string; distance: number }> = [];

	for (const node of graph.values()) {
		for (const [connectedId, connection] of node.connections) {
			if (connection.type === "tunnel") {
				// Avoid duplicates
				const pairKey = [node.id, connectedId].sort().join("||");
				if (!tunnels.some(t => [t.from, t.to].sort().join("||") === pairKey)) {
					tunnels.push({
						from: node.id,
						to: connectedId,
						distance: 1,
					});
				}
			}
		}
	}

	return tunnels;
}

/**
 * Get room statistics for the palace.
 */
export async function getPalaceStats(): Promise<{
	totalRooms: number;
	totalWings: number;
	roomsByWing: Record<string, number>;
	tunnelCount: number;
	totalMemories: number;
}> {
	const db = getDb();

	// Get room counts by wing
	const wingStats = await db.query<Array<{ wing: string; count: number }>>(
		`SELECT wing, count() as count FROM memory GROUP BY wing;`,
	);

	const roomsByWing: Record<string, number> = {};
	let totalRooms = 0;
	let totalWings = 0;

	if (wingStats) {
		for (const stat of wingStats) {
			roomsByWing[stat.wing] = stat.count;
			totalRooms += stat.count;
			totalWings++;
		}
	}

	// Get total memory count
	const totalMemoriesResult = await db.query<Array<{ count: number }>>(
		`SELECT count() as count FROM memory GROUP ALL;`,
	);
	const totalMemories = totalMemoriesResult?.[0]?.count ?? 0;

	// Get tunnel count
	const tunnels = await getTunnels();

	return {
		totalRooms,
		totalWings,
		roomsByWing,
		tunnelCount: tunnels.length,
		totalMemories,
	};
}

/**
 * Cached palace graph (refreshed on demand).
 */
let cachedGraph: Map<string, PalaceNode> | null = null;

/**
 * Get the cached palace graph, rebuilding if stale.
 */
export async function getCachedPalaceGraph(): Promise<Map<string, PalaceNode>> {
	if (!cachedGraph) {
		cachedGraph = await buildPalaceGraph();
	}
	return cachedGraph;
}

/**
 * Invalidate the cached palace graph.
 */
export function invalidatePalaceGraph(): void {
	cachedGraph = null;
	logger.debug("Palace graph cache invalidated");
}
