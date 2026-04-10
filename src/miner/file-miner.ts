/**
 * File mining for MemPalace.
 *
 * Scans directories recursively, chunks files by paragraph,
 * generates embeddings, and stores memories in SurrealDB.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import ignore from "ignore";
type IgnoreInstance = ignore.Ignore;
import { logger } from "../logger";
import { addMemories } from "../memory";
import { embedBatch } from "../embed";
import { chunkByParagraphs, type Chunk } from "./chunker";
import { detectRoom, type RoomConfig } from "./room-detector";
import { assignWing, type WingConfig } from "./wing-router";
import type { MemoryInput } from "../types";
/** Maximum files to process in a single mining run to prevent OOM. */
const MAX_FILES_PER_MINE = 5000;

/** File mining options */
export interface FileMinerOptions {
	/** Directory to mine */
	directory: string;
	/** Wing assignment (auto-detected if not provided) */
	wing?: string;
	/** Room taxonomy (defaults to DEFAULT_ROOMS) */
	rooms?: RoomConfig[];
	/** Wing taxonomy (defaults to DEFAULT_WINGS) */
	wings?: WingConfig[];
	/** Source identifier for mined memories */
	source?: string;
	/** Maximum file size to process (bytes) */
	maxFileSize?: number;
	/** File extensions to process */
	extensions?: string[];
	/** Whether to follow symlinks */
	followSymlinks?: boolean;
	/** Batch size for embedding */
	batchSize?: number;
}

/** File mining result */
export interface FileMiningResult {
	/** Total files scanned */
	filesScanned: number;
	/** Files that were processed */
	filesProcessed: number;
	/** Files that were skipped */
	filesSkipped: number;
	/** Total chunks created */
	chunksCreated: number;
	/** Memories stored */
	memoriesStored: number;
	/** Errors encountered */
	errors: Array<{ file: string; error: string }>;
	/** Files skipped and reasons */
	skippedFiles: Array<{ file: string; reason: string }>;
}

/** Default file extensions to process */
const DEFAULT_EXTENSIONS = [
	".ts",
	".js",
	".jsx",
	".tsx",
	".md",
	".txt",
	".json",
	".yaml",
	".yml",
	".toml",
	".ini",
	".cfg",
	".conf",
	".sh",
	".bash",
	".zsh",
	".py",
	".rs",
	".go",
	".java",
	".c",
	".cpp",
	".h",
	".hpp",
	".cs",
	".rb",
	".php",
	".swift",
	".kt",
	".scala",
];

/** Default maximum file size (1MB) */
const DEFAULT_MAX_FILE_SIZE = 1024 * 1024;

/** Binary file signatures */
const BINARY_SIGNATURES: Array<{ magic: number[]; offset?: number }> = [
	{ magic: [0x89, 0x50, 0x4e, 0x47] }, // PNG
	{ magic: [0xff, 0xd8, 0xff] }, // JPEG
	{ magic: [0x47, 0x49, 0x46] }, // GIF
	{ magic: [0x50, 0x4b, 0x03, 0x04] }, // ZIP
	{ magic: [0x50, 0x4b, 0x05, 0x06] }, // ZIP empty
	{ magic: [0x50, 0x4b, 0x07, 0x08] }, // ZIP spanned
	{ magic: [0xca, 0xfe, 0xba, 0xbe] }, // Java class
	{ magic: [0x7f, 0x45, 0x4c, 0x46] }, // ELF
	{ magic: [0x4d, 0x5a] }, // PE/EXE
	{ magic: [0x25, 0x50, 0x44, 0x46] }, // PDF
];

/**
 * Mine a directory recursively.
 *
 * Scans the directory, chunks files, generates embeddings,
 * and stores memories in the database.
 *
 * @param options - Mining options.
 * @returns Mining result with statistics.
 */
export async function mineDirectory(options: FileMinerOptions): Promise<FileMiningResult> {
	const {
		directory,
		wing: explicitWing,
		rooms = [],
		wings = [],
		source = `file-mining:${directory}`,
		maxFileSize = DEFAULT_MAX_FILE_SIZE,
		extensions = DEFAULT_EXTENSIONS,
		followSymlinks = false,
		batchSize = 16,
	} = options;

	logger.info("Starting directory mining", { directory, source });

	const result: FileMiningResult = {
		filesScanned: 0,
		filesProcessed: 0,
		filesSkipped: 0,
		chunksCreated: 0,
		memoriesStored: 0,
		errors: [],
		skippedFiles: [],
	};

	// Load gitignore patterns
	const ignoreManager = await loadIgnorePatterns(directory);

	// Get wing assignment
	const wingAssignment = explicitWing ?? assignWing(directory, {}, wings).wing;

	// Scan directory recursively
	const files = await scanDirectory(directory, directory, ignoreManager, {
		maxFileSize,
		extensions,
		followSymlinks,
		result,
	});

	logger.info("Directory scan complete", {
		dirFiles: result.filesScanned,
		dirSkipped: result.filesSkipped,
	});

	// Warn if too many files — prevent OOM on large repositories
	if (files.length > MAX_FILES_PER_MINE) {
		logger.warn("File count exceeds safe limit, truncating", {
			fileCount: files.length,
			limit: MAX_FILES_PER_MINE,
		});
		files = files.slice(0, MAX_FILES_PER_MINE);
	}

	// Process files in batches
	for (let i = 0; i < files.length; i += batchSize) {
		const batch = files.slice(i, i + batchSize);
		const batchMemories: MemoryInput[] = [];

		for (const file of batch) {
			try {
				const content = await fs.readFile(file, "utf-8");
				const fileSource = `${source}:${path.relative(directory, file)}`;

				// Chunk the file
				const chunks = chunkByParagraphs(content, fileSource);

				if (chunks.length === 0) continue;

				// Detect room
				const roomDetection = detectRoom(file, content, rooms);

				// Add each chunk to batch
				for (const chunk of chunks) {
					batchMemories.push({
						text: chunk.text,
						embedding: new Float32Array(384), // Placeholder, will be replaced
						wing: wingAssignment,
						room: roomDetection.room,
						source: fileSource,
					});
				}

				result.filesProcessed++;
				result.chunksCreated += chunks.length;
			} catch (err) {
				result.errors.push({
					file: path.relative(directory, file),
					error: String(err),
				});
			}
		}

		// Generate embeddings for batch
		if (batchMemories.length > 0) {
			const texts = batchMemories.map(m => m.text);

			try {
				const embeddings = await embedBatch(texts);

				// Update memories with embeddings
				for (let j = 0; j < batchMemories.length; j++) {
					batchMemories[j].embedding = embeddings[j];
				}

				// Store in database
				await addMemories(batchMemories);
				result.memoriesStored += batchMemories.length;
			} catch (err) {
				logger.error("Batch embedding failed", {
					error: String(err),
					batchSize: batchMemories.length,
				});
				result.errors.push({
					file: "batch",
					error: `Embedding batch failed: ${String(err)}`,
				});
			}
		}
	}

	logger.info("Directory mining complete", {
		filesProcessed: result.filesProcessed,
		chunksCreated: result.chunksCreated,
		memoriesStored: result.memoriesStored,
		errors: result.errors.length,
	});

	return result;
}

/**
 * Load and parse .gitignore patterns.
 */
async function loadIgnorePatterns(directory: string): Promise<IgnoreInstance> {
	const ig = ignore();

	try {
		const gitignorePath = path.join(directory, ".gitignore");
		const content = await fs.readFile(gitignorePath, "utf-8");
		const patterns = content.split("\n").filter(line => line.trim() && !line.startsWith("#"));
		ig.add(patterns);
	} catch {
		// No .gitignore, continue with default ignores
	}

	// Always ignore these patterns
	ig.add(["node_modules", ".git", "dist", "build", "target", ".next", ".nuxt", ".cache", "coverage", ".nyc_output"]);

	return ig;
}

/**
 * Scan directory recursively for files to process.
 */
async function scanDirectory(
	rootDir: string,
	currentDir: string,
	ig: IgnoreInstance,
	options: {
		maxFileSize: number;
		extensions: string[];
		followSymlinks: boolean;
		result: FileMiningResult;
	},
): Promise<string[]> {
	const files: string[] = [];

	try {
		const entries = await fs.readdir(currentDir, { withFileTypes: true });

		for (const entry of entries) {
			const fullPath = path.join(currentDir, entry.name);
			const relativePath = path.relative(rootDir, fullPath);
		// Check if this entry should be ignored (handles both files and directories)
		// Add trailing slash for directories so ignore patterns like 'node_modules/' match
		const ignorePath = entry.isDirectory() ? relativePath + "/" : relativePath;
		if (ig.ignores(ignorePath)) {
			continue;
		}

			// Handle directories
			if (entry.isDirectory()) {
				// Skip hidden directories
				if (entry.name.startsWith(".")) continue;

				// Skip common non-source directories
				const skipDirs = ["node_modules", "dist", "build", "target", ".next", ".nuxt", ".cache", "coverage"];
				if (skipDirs.includes(entry.name)) continue;

				const subFiles = await scanDirectory(rootDir, fullPath, ig, options);
				files.push(...subFiles);
				continue;
			}

			// Handle files
			if (!entry.isFile()) continue;

			// Skip hidden files
			if (entry.name.startsWith(".")) {
				options.result.skippedFiles.push({
					file: relativePath,
					reason: "hidden file",
				});
				options.result.filesSkipped++;
				continue;
			}

			// Check extension
			const ext = path.extname(entry.name).toLowerCase();
			if (options.extensions.length > 0 && !options.extensions.includes(ext)) {
				options.result.skippedFiles.push({
					file: relativePath,
					reason: `extension ${ext} not in allowlist`,
				});
				options.result.filesSkipped++;
				continue;
			}

			// Check file size
			try {
				const stat = await fs.stat(fullPath);
				if (stat.size > options.maxFileSize) {
					options.result.skippedFiles.push({
						file: relativePath,
						reason: `file too large (${stat.size} > ${options.maxFileSize})`,
					});
					options.result.filesSkipped++;
					continue;
				}

				// Check if binary
				if (await isBinaryFile(fullPath)) {
					options.result.skippedFiles.push({
						file: relativePath,
						reason: "binary file",
					});
					options.result.filesSkipped++;
					continue;
				}
			} catch {
				options.result.filesSkipped++;
				continue;
			}

			files.push(fullPath);
			options.result.filesScanned++;
		}
	} catch (err) {
		logger.warn("Directory scan failed", {
			directory: currentDir,
			error: String(err),
		});
	}

	return files;
}

/**
 * Check if a file is binary.
 */
async function isBinaryFile(filePath: string): Promise<boolean> {
	try {
		const buffer = Buffer.alloc(8192);
		const fd = await fs.open(filePath, "r");
		try {
			const { bytesRead } = await fd.read(buffer, 0, 8192, 0);

			// Check for null bytes
			for (let i = 0; i < bytesRead; i++) {
				if (buffer[i] === 0) {
					return true; // Null byte found = binary
				}
			}

			// Check magic signatures
			for (const { magic, offset = 0 } of BINARY_SIGNATURES) {
				let match = true;
				for (let i = 0; i < magic.length; i++) {
					if (buffer[offset + i] !== magic[i]) {
						match = false;
						break;
					}
				}
				if (match) return true;
			}

			return false;
		} finally {
			await fd.close();
		}
	} catch {
		return true; // Assume binary if can't read
	}
}

/**
 * Mine a single file.
 *
 * @param filePath - Path to the file.
 * @param options - Mining options (directory context for wing/room detection).
 * @returns Mining result for the single file.
 */
export async function mineFile(
	filePath: string,
	options: {
		wing?: string;
		rooms?: RoomConfig[];
		wings?: WingConfig[];
		source?: string;
	},
): Promise<{ chunks: Chunk[]; memories: MemoryInput[] }> {
	const { wing: explicitWing, rooms = [], wings = [], source = `file:${filePath}` } = options;

	const content = await fs.readFile(filePath, "utf-8");
	const chunks = chunkByParagraphs(content, source);

	// Detect room
	const roomDetection = detectRoom(filePath, content, rooms);

	// Get wing
	const wingAssignment = explicitWing ?? assignWing(filePath, {}, wings).wing;

	// Generate embeddings
	const texts = chunks.map(c => c.text);
	const embeddings = await embedBatch(texts);

	const memories: MemoryInput[] = chunks.map((chunk, i) => ({
		text: chunk.text,
		embedding: embeddings[i],
		wing: wingAssignment,
		room: roomDetection.room,
		source,
	}));

	return { chunks, memories };
}
