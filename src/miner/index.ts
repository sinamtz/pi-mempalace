/**
 * Unified mining API for MemPalace.
 *
 * Provides a single entry point for all mining operations.
 */

// Re-export chunker
export {
	chunkByParagraphs,
	chunkConversation,
	splitParagraphs,
	CHUNK_CONFIG,
	type Chunk,
	type ChunkOptions,
} from "./chunker";

// Re-export room detector
export {
	detectRoom,
	detectConversationRoom,
	createTaxonomyFromDirectories,
	DEFAULT_ROOMS,
	type RoomConfig,
	type RoomDetectionResult,
} from "./room-detector";

// Re-export wing router
export {
	assignWing,
	assignWingFromProject,
	createWingsFromEnvironment,
	DEFAULT_WINGS,
	type WingConfig,
	type WingAssignment,
	type WingAssignmentContext,
} from "./wing-router";

// Re-export file miner
export {
	mineDirectory,
	mineFile,
	type FileMinerOptions,
	type FileMiningResult,
} from "./file-miner";

// Re-export conversation miner
export {
	mineConversation,
	parseConversation,
	formatConversation,
	type ConvoMinerOptions,
	type ConvoMiningResult,
	type ParsedMessage,
	type ConversationFormat,
} from "./convo-miner";

import { mineDirectory } from "./file-miner";
import { mineConversation } from "./convo-miner";
import type { RoomConfig } from "./room-detector";
import type { WingConfig } from "./wing-router";
import type { FileMiningResult } from "./file-miner";
import type { ConvoMiningResult } from "./convo-miner";

// Import types directly from the parent types module
type MemoryInput = import("../types").MemoryInput;

/**
 * Mining result union type.
 */
export type MiningResult = FileMiningResult | ConvoMiningResult;

/**
 * Mine from a path (auto-detects file or directory).
 *
 * @param miningPath - File or directory path.
 * @param options - Mining options.
 * @returns Mining result.
 */
export async function mine(
	miningPath: string,
	options: {
		type?: "auto" | "file" | "directory" | "conversation";
		wing?: string;
		rooms?: RoomConfig[];
		wings?: WingConfig[];
		source?: string;
	},
): Promise<FileMiningResult | ConvoMiningResult> {
	const { type = "auto", ...rest } = options;

	if (type === "directory") {
		return mineDirectory({ directory: miningPath, ...rest });
	}

	if (type === "file") {
		const result = await mineFileFromPath(miningPath, rest);
		return {
			filesScanned: 1,
			filesProcessed: result.memories.length > 0 ? 1 : 0,
			filesSkipped: result.memories.length === 0 ? 1 : 0,
			chunksCreated: result.memories.length,
			memoriesStored: result.memories.length,
			errors: [],
			skippedFiles: [],
		};
	}

	if (type === "conversation") {
		// miningPath contains the conversation text
		return mineConversation({ text: miningPath, source: rest.source, ...rest });
	}

	// Auto-detect
	if (await isDirectory(miningPath)) {
		return mineDirectory({ directory: miningPath, ...rest });
	}

	// Treat as file
	const result = await mineFileFromPath(miningPath, rest);
	return {
		filesScanned: 1,
		filesProcessed: result.memories.length > 0 ? 1 : 0,
		filesSkipped: result.memories.length === 0 ? 1 : 0,
		chunksCreated: result.memories.length,
		memoriesStored: result.memories.length,
		errors: [],
		skippedFiles: [],
	};
}

/**
 * Check if a path is a directory.
 */
async function isDirectory(path: string): Promise<boolean> {
	try {
		const { stat } = await import("node:fs/promises");
		const st = await stat(path);
		return st.isDirectory();
	} catch {
		return false;
	}
}

/**
 * Mine a single file (helper for mine()).
 */
async function mineFileFromPath(
	filePath: string,
	options: {
		wing?: string;
		rooms?: RoomConfig[];
		wings?: WingConfig[];
		source?: string;
	},
): Promise<{ memories: MemoryInput[] }> {
	const { mineFile } = await import("./file-miner");
	const result = await mineFile(filePath, options);
	return { memories: result.memories };
}
