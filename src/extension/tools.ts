/**
 * Pi tool registrations for MemPalace
 *
 * Registers all MemPalace tools that the LLM can call:
 * - mempalace_add_memory: Add a new memory
 * - mempalace_search: Vector similarity search
 * - mempalace_mine_directory: Mine a directory
 * - mempalace_mine_conversation: Mine conversation text
 * - mempalace_get_memory: Retrieve memory by ID
 * - mempalace_delete_memory: Remove a memory
 * - mempalace_stats: Palace statistics
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AgentToolResult } from "@mariozechner/pi-coding-agent";
import { Type } from "@sinclair/typebox";
import { logger } from "../logger";

import { init } from "../index";
import { addMemory, queryMemories, getMemory, deleteMemory, countMemories, listMemories } from "../memory";
import { embed } from "../embed";
import { mineDirectory, mineConversation } from "../miner";
import type { MemoryResult, QueryOptions } from "../types";

/** Initialize database lazily */
let dbInitialized = false;

async function ensureDb(): Promise<void> {
	if (!dbInitialized) {
		await init();
		dbInitialized = true;
	}
}

/**
 * Sanitize text for safe TUI display.
 * Replaces tabs with spaces and truncates if needed.
 */
function sanitizeText(text: string, maxLength = 2000): string {
	return text
		.replace(/\t/g, "    ") // Tabs to 4 spaces
		.slice(0, maxLength);
}

/**
 * Format memory for display.
 */
function formatMemoryResult(result: MemoryResult): string {
	const m = result.memory;
	return [
		`ID: ${m.id}`,
		`Wing: ${m.wing} | Room: ${m.room}`,
		`Source: ${m.source}`,
		`Score: ${(result.score * 100).toFixed(1)}%`,
		"",
		sanitizeText(m.text, 500),
		"",
		"---",
	].join("\n");
}

/**
 * Register all MemPalace tools with the ExtensionAPI.
 */
export function registerTools(pi: ExtensionAPI): void {
	// -------------------------------------------------------------------------
	// mempalace_add_memory
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "mempalace_add_memory",
		label: "Add Memory",
		description:
			"Add a new semantic memory to the palace. Generates an embedding for the text and stores it with spatial metadata (wing/room) for later retrieval.",
		parameters: Type.Object({
			text: Type.String({
				description: "The memory content to store. Should be concise but capture the key information.",
			}),
			wing: Type.String({ description: "High-level category (e.g., 'work', 'personal', 'project-x')." }),
			room: Type.String({
				description: "Specific location within the wing (e.g., 'tech-stack', 'debugging', 'architecture').",
			}),
			source: Type.Optional(Type.String({ description: "Where this memory came from. Defaults to 'manual'." })),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
			const {
				text,
				wing,
				room,
				source = "manual",
			} = params as {
				text: string;
				wing: string;
				room: string;
				source?: string;
			};

			logger.debug("Adding memory", { wing, room, textLength: text.length });

			onUpdate?.({
				content: [{ type: "text", text: "Generating embedding..." }],
				details: { phase: "embedding" },
			});

			await ensureDb();

			const embedding = await embed(text);

			onUpdate?.({
				content: [{ type: "text", text: "Storing memory..." }],
				details: { phase: "storing" },
			});

			const memory = await addMemory({
				text,
				embedding,
				wing,
				room,
				source,
			});

			return {
				content: [
					{
						type: "text",
						text: [
							"Memory added successfully:",
							`ID: ${memory.id}`,
							`Wing: ${memory.wing} | Room: ${memory.room}`,
							`Source: ${memory.source}`,
							"",
							`"${sanitizeText(text, 200)}"`,
						].join("\n"),
					},
				],
				details: { memoryId: String(memory.id), wing, room },
			} satisfies AgentToolResult<Record<string, unknown>>;
		},
	});

	// -------------------------------------------------------------------------
	// mempalalce_search
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "mempalace_search",
		label: "Search Memories",
		description:
			"Search for semantically similar memories using vector similarity. Finds memories related to the query based on meaning, not just keywords.",
		parameters: Type.Object({
			query: Type.String({ description: "The search query. Describe what you're looking for." }),
			limit: Type.Optional(
				Type.Number({ description: "Maximum number of results. Default: 5.", default: 5, minimum: 1, maximum: 50 }),
			),
			wing: Type.Optional(Type.String({ description: "Filter by wing (e.g., 'work', 'personal')." })),
			room: Type.Optional(Type.String({ description: "Filter by room within the wing." })),
			minScore: Type.Optional(
				Type.Number({
					description: "Minimum similarity score (0-1). Default: 0.3.",
					default: 0.3,
					minimum: 0,
					maximum: 1,
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
			const {
				query,
				limit = 5,
				wing,
				room,
				minScore = 0.3,
			} = params as {
				query: string;
				limit?: number;
				wing?: string;
				room?: string;
				minScore?: number;
			};

			logger.debug("Searching memories", { query, limit, wing, room, minScore });

			onUpdate?.({
				content: [{ type: "text", text: "Generating query embedding..." }],
				details: { phase: "embedding" },
			});

			await ensureDb();

			const queryEmbedding = await embed(query);

			onUpdate?.({
				content: [{ type: "text", text: "Searching..." }],
				details: { phase: "searching" },
			});

			const options: QueryOptions = { limit, wing, room, minScore };
			const results = await queryMemories(queryEmbedding, options);

			if (results.length === 0) {
				return {
					content: [{ type: "text", text: "No matching memories found." }],
					details: { count: 0, query },
				};
			}

			const formatted = results.map(formatMemoryResult).join("\n");

			return {
				content: [
					{
						type: "text",
						text: [`Found ${results.length} matching memory(s):`, "", formatted].join("\n"),
					},
				],
				details: {
					count: results.length,
					results: results.map(r => ({ id: String(r.memory.id), score: r.score })),
				},
			};
		},
	});

	// -------------------------------------------------------------------------
	// mempalace_mine_directory
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "mempalace_mine_directory",
		label: "Mine Directory",
		description:
			"Scan a directory recursively, chunk files, generate embeddings, and store memories. Use after understanding a codebase to remember key architectural decisions and patterns.",
		parameters: Type.Object({
			directory: Type.String({
				description: "Path to the directory to mine. Defaults to current working directory.",
			}),
			wing: Type.Optional(Type.String({ description: "Override the auto-detected wing." })),
			source: Type.Optional(
				Type.String({ description: "Source identifier for mined memories. Defaults to directory path." }),
			),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, ctx) {
			const { directory, wing, source } = params as {
				directory: string;
				wing?: string;
				source?: string;
			};

			// Default to current directory if not specified
			const miningDir = directory || ctx.cwd;

			logger.debug("Mining directory", { directory: miningDir, wing, source });

			onUpdate?.({
				content: [{ type: "text", text: `Scanning ${miningDir}...` }],
				details: { phase: "scanning" },
			});

			await ensureDb();

			const result = await mineDirectory({
				directory: miningDir,
				wing,
				source: source ?? `directory:${miningDir}`,
			});

			return {
				content: [
					{
						type: "text",
						text: [
							"Directory mining complete:",
							`Files scanned: ${result.filesScanned}`,
							`Files processed: ${result.filesProcessed}`,
							`Files skipped: ${result.filesSkipped}`,
							`Chunks created: ${result.chunksCreated}`,
							`Memories stored: ${result.memoriesStored}`,
							result.errors.length > 0 ? `Errors: ${result.errors.length}` : "",
						]
							.filter(Boolean)
							.join("\n"),
					},
				],
				details: {
					filesScanned: result.filesScanned,
					filesProcessed: result.filesProcessed,
					filesSkipped: result.filesSkipped,
					chunksCreated: result.chunksCreated,
					memoriesStored: result.memoriesStored,
					errorCount: result.errors.length,
				},
			};
		},
	});

	// -------------------------------------------------------------------------
	// mempalace_mine_conversation
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "mempalace_mine_conversation",
		label: "Mine Conversation",
		description:
			"Parse a conversation transcript into Q+A pairs and store as memories. Good for capturing decisions, explanations, and discussions.",
		parameters: Type.Object({
			text: Type.String({ description: "The conversation text to mine. Can be plain text or structured format." }),
			wing: Type.Optional(Type.String({ description: "Override the auto-detected wing." })),
			source: Type.Optional(Type.String({ description: "Source identifier. Defaults to 'conversation'." })),
			mode: Type.Optional(
				Type.String({
					description: "Chunking mode: 'exchanges' (Q+A pairs) or 'paragraphs'. Default: 'exchanges'.",
					default: "exchanges",
				}),
			),
		}),

		async execute(_toolCallId, params, _signal, onUpdate, _ctx) {
			const {
				text,
				wing,
				source = "conversation",
				mode = "exchanges",
			} = params as {
				text: string;
				wing?: string;
				source?: string;
				mode?: "exchanges" | "paragraphs";
			};

			logger.debug("Mining conversation", { source, mode, textLength: text.length });

			onUpdate?.({
				content: [{ type: "text", text: "Parsing conversation..." }],
				details: { phase: "parsing" },
			});

			await ensureDb();

			const result = await mineConversation({
				text,
				wing,
				source,
				mode,
			});

			return {
				content: [
					{
						type: "text",
						text: [
							"Conversation mining complete:",
							`Exchanges found: ${result.exchangesFound}`,
							`Chunks created: ${result.chunksCreated}`,
							`Memories stored: ${result.memoriesStored}`,
							`Detected room: ${result.detectedRoom}`,
							`Assigned wing: ${result.assignedWing}`,
							result.errors.length > 0 ? `Errors: ${result.errors.length}` : "",
						]
							.filter(Boolean)
							.join("\n"),
					},
				],
				details: {
					exchangesFound: result.exchangesFound,
					chunksCreated: result.chunksCreated,
					memoriesStored: result.memoriesStored,
					detectedRoom: result.detectedRoom,
					assignedWing: result.assignedWing,
				},
			};
		},
	});

	// -------------------------------------------------------------------------
	// mempalace_get_memory
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "mempalace_get_memory",
		label: "Get Memory",
		description:
			"Retrieve a specific memory by its ID. Use when you know the memory ID from a previous search result.",
		parameters: Type.Object({
			id: Type.String({ description: "The memory ID (e.g., 'memory:xxxxx')." }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { id } = params as { id: string };

			logger.debug("Getting memory", { id });

			await ensureDb();

			const memory = await getMemory(id);

			if (!memory) {
				return {
					content: [{ type: "text", text: `Memory not found: ${id}` }],
					details: { found: false, id },
				};
			}

			return {
				content: [
					{
						type: "text",
						text: [
							"Memory:",
							`ID: ${memory.id}`,
							`Wing: ${memory.wing} | Room: ${memory.room}`,
							`Source: ${memory.source}`,
							`Timestamp: ${memory.timestamp.toISOString()}`,
							"",
							sanitizeText(memory.text, 2000),
						].join("\n"),
					},
				],
				details: {
					found: true,
					id: String(memory.id),
					wing: memory.wing,
					room: memory.room,
					source: memory.source,
				},
			};
		},
	});

	// -------------------------------------------------------------------------
	// mempalace_delete_memory
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "mempalace_delete_memory",
		label: "Delete Memory",
		description: "Delete a memory by ID. Use when a memory is no longer relevant or was stored incorrectly.",
		parameters: Type.Object({
			id: Type.String({ description: "The memory ID to delete." }),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { id } = params as { id: string };

			logger.debug("Deleting memory", { id });

			await ensureDb();

			const deleted = await deleteMemory(id);

			return {
				content: [
					{
						type: "text",
						text: deleted ? `Memory deleted: ${id}` : `Memory not found: ${id}`,
					},
				],
				details: { deleted, id },
			};
		},
	});

	// -------------------------------------------------------------------------
	// mempalace_stats
	// -------------------------------------------------------------------------
	pi.registerTool({
		name: "mempalace_stats",
		label: "Palace Statistics",
		description: "Get statistics about the memory palace: total memories, memories per wing/room, storage info.",
		parameters: Type.Object({
			wing: Type.Optional(Type.String({ description: "Filter stats by wing." })),
			room: Type.Optional(Type.String({ description: "Filter stats by room (requires wing)." })),
		}),

		async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
			const { wing, room } = params as { wing?: string; room?: string };

			logger.debug("Getting palace stats", { wing, room });

			await ensureDb();

			const totalCount = await countMemories({ wing, room });
			const memories = await listMemories({ wing, room, limit: 1000 });

			// Group by wing and room
			const byWing: Record<string, number> = {};
			const byRoom: Record<string, number> = {};

			for (const m of memories) {
				byWing[m.wing] = (byWing[m.wing] ?? 0) + 1;
				byRoom[m.room] = (byRoom[m.room] ?? 0) + 1;
			}

			const wingLines = Object.entries(byWing)
				.sort((a, b) => b[1] - a[1])
				.map(([w, c]) => `  ${w}: ${c}`)
				.join("\n");

			const roomLines = Object.entries(byRoom)
				.sort((a, b) => b[1] - a[1])
				.slice(0, 10)
				.map(([r, c]) => `  ${r}: ${c}`)
				.join("\n");

			return {
				content: [
					{
						type: "text",
						text: [
							"MemPalace Statistics:",
							`Total memories: ${totalCount}`,
							"",
							"By Wing:",
							wingLines || "  (none)",
							"",
							"By Room (top 10):",
							roomLines || "  (none)",
						].join("\n"),
					},
				],
				details: {
					totalCount,
					byWing,
					byRoom: Object.fromEntries(Object.entries(byRoom).slice(0, 10)),
				},
			};
		},
	});
}
