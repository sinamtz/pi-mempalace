/**
 * Memory table operations for MemPalace.
 *
 * Provides CRUD operations and vector search for semantic memories.
 * All operations use the SurrealDB instance initialized by db.ts.
 *
 * API compatible with SurrealDB v3.
 */

import { Table, StringRecordId } from "surrealdb";
import { getDb, toSurrealArray, fromSurrealArray } from "./broker";
import { isEnoent } from "./fs-error";
import { logger } from "./logger";
import { sleep } from "./runtime";
import type { Embedding, Memory, MemoryId, MemoryInput, MemoryUpdate, MemoryResult, QueryOptions } from "./types";

/** Memory table reference */
const MEMORY_TABLE = new Table("memory");

/** Memory record as returned from SurrealDB */
interface MemoryRecord {
	id: string;
	text: string;
	embedding: number[];
	wing: string;
	room: string;
	source: string;
	timestamp: Date | string;
}

/**
 * Convert a raw memory record from SurrealDB to a Memory object.
 */
function toMemory(record: unknown): Memory {
	const r = record as MemoryRecord;
	return {
		id: String(r.id),
		text: r.text ?? "",
		embedding: r.embedding ? fromSurrealArray(r.embedding) : new Float32Array(384),
		wing: r.wing ?? "",
		room: r.room ?? "",
		source: r.source ?? "",
		timestamp: r.timestamp instanceof Date ? r.timestamp : r.timestamp ? new Date(r.timestamp) : new Date(),
	};
}

/**
 * Convert a MemoryId to a SurrealDB record ID.
 */
function toRecordId(id: MemoryId): StringRecordId {
	return new StringRecordId(String(id));
}

/**
 * Add a new memory to the palace.
 *
 * @param input - Memory content and metadata.
 * @returns The created memory record with generated ID and timestamp.
 * @throws Error if database is not initialized.
 */
export async function addMemory(input: MemoryInput, retries = 3): Promise<Memory> {
	const db = getDb();
	const now = new Date();

	for (let i = 0; i < retries; i++) {
		try {
			const record = await db.insert<MemoryRecord>(MEMORY_TABLE, {
				text: input.text,
				embedding: toSurrealArray(input.embedding),
				wing: input.wing,
				room: input.room,
				source: input.source,
				timestamp: now,
			});
			logger.debug("Memory added", { id: record[0]?.id, wing: input.wing, room: input.room });
			return toMemory(record[0]);
		} catch (err) {
			const msg = String(err);
			if (i < retries - 1 && msg.includes("Transaction write conflict")) {
				await sleep(10 * (i + 1));
				continue;
			}
			throw err;
		}
	}
	throw new Error("unreachable");
}

/**
 * Upsert an existing memory by ID.
 *
 * If the memory exists, updates only the provided fields.
 * If the memory doesn't exist, creates it (requires all fields).
 *
 * @param id - Memory ID to upsert.
 * @param data - Fields to update or complete memory data for insert.
 * @returns The upserted memory record.
 * @throws Error if database is not initialized.
 */
export async function upsertMemory(id: MemoryId, data: MemoryUpdate | MemoryInput): Promise<Memory> {
	const db = getDb();
	const recordId = toRecordId(id);

	try {
		// Try to update existing record
		const existing = await db.select<MemoryRecord>(recordId);

		if (!existing) {
			throw new Error(`Memory not found: ${id}`);
		}

		const existingData = toMemory(existing);

		// Merge with existing data
		const embedding = data.embedding ? toSurrealArray(data.embedding) : Array.from(existingData.embedding);
		const updated: Partial<MemoryRecord> = {
			text: data.text ?? existingData.text,
			embedding,
			wing: data.wing ?? existingData.wing,
			room: data.room ?? existingData.room,
			source: data.source ?? existingData.source,
			timestamp: existingData.timestamp,
		};

		// Use update with content
		const record = await db.update<MemoryRecord>(recordId).content(updated);

		logger.debug("Memory updated", { id, wing: updated.wing, room: updated.room });

		return toMemory(record);
	} catch (err) {
		// If not found, create new
		if (isEnoent(err)) {
			if (!("embedding" in data) || !("text" in data)) {
				throw new Error("Cannot create memory without required fields (text, embedding)");
			}

			const input = data as MemoryInput;
			// Use insert for creating new records
			const record = await db.insert<MemoryRecord>(MEMORY_TABLE, {
				text: input.text,
				embedding: Array.from(input.embedding),
				wing: input.wing,
				room: input.room,
				source: input.source,
				timestamp: new Date(),
			});

			logger.debug("Memory created (upsert)", { id: record[0]?.id });

			return toMemory(record[0]);
		}
		throw err;
	}
}

/**
 * Delete a memory by ID.
 *
 * @param id - Memory ID to delete.
 * @returns True if deleted, false if not found.
 * @throws Error if database is not initialized.
 */
export async function deleteMemory(id: MemoryId): Promise<boolean> {
	const db = getDb();

	try {
		await db.delete(toRecordId(id));
		logger.debug("Memory deleted", { id });
		return true;
	} catch (err) {
		if (isEnoent(err)) {
			return false;
		}
		throw err;
	}
}

/**
 * Retrieve a single memory by ID.
 *
 * @param id - Memory ID to retrieve.
 * @returns The memory record or null if not found.
 * @throws Error if database is not initialized.
 */
export async function getMemory(id: MemoryId): Promise<Memory | null> {
	const db = getDb();

	try {
		const record = await db.select<MemoryRecord>(toRecordId(id));

		if (!record) {
			return null;
		}

		return toMemory(record);
	} catch (err) {
		if (isEnoent(err)) {
			return null;
		}
		throw err;
	}
}

/**
 * Query memories using HNSW vector search with optional metadata filters.
 *
 * Uses SurrealDB's HNSW index for approximate nearest neighbor search
 * with cosine similarity distance metric.
 *
 * @param queryEmbedding - The query vector to search for.
 * @param options - Optional filter and pagination options.
 * @returns Array of matching memories sorted by relevance score.
 * @throws Error if database is not initialized.
 */
export async function queryMemories(queryEmbedding: Embedding, options: QueryOptions = {}): Promise<MemoryResult[]> {
	const db = getDb();
	const { limit = 10, wing, room, source, minScore = 0.0 } = options;

	// Build the query
	const vectorStr = `[${toSurrealArray(queryEmbedding).join(",")}]`;

	// Build WHERE clause for metadata filters
	const filters: string[] = [];

	if (wing) {
		filters.push(`wing = "${wing}"`);
	}
	if (room) {
		filters.push(`room = "${room}"`);
	}
	if (source) {
		filters.push(`source = "${source}"`);
	}

	const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

	// Execute vector search with HNSW (SurrealDB 3.0 syntax)
	const query = `
		SELECT id, text, embedding, wing, room, source, timestamp,
			vector::distance::knn() AS _score
		FROM memory
		${whereClause ? `${whereClause} AND` : "WHERE"} embedding <|${limit},${limit}|> ${vectorStr}
		ORDER BY _score ASC
		LIMIT ${limit};
	`;

	const rawResults = await db.query<Array<MemoryRecord & { _score: number }>>(query);

	const results: Array<MemoryRecord & { _score: number }> = Array.isArray(rawResults[0]) ? rawResults[0] : rawResults;
	if (!results || results.length === 0) {
		return [];
	}

	// Filter by minimum score and map to MemoryResult
	const memories: MemoryResult[] = [];

	for (const row of results) {
		if (row._score === null || row._score < minScore) {
			continue;
		}

		memories.push({
			memory: toMemory(row),
			score: row._score,
		});
	}

	logger.debug("Memory query", {
		resultCount: memories.length,
		limit,
		wing,
		room,
		source,
		minScore,
	});

	return memories;
}

/**
 * Get all memories in a specific wing or room.
 *
 * @param options - Filter by wing and/or room.
 * @param options.wing - Wing to filter by.
 * @param options.room - Room to filter by.
 * @param options.limit - Maximum number of results.
 * @returns Array of memories matching the filter.
 */
export async function listMemories(options: { wing?: string; room?: string; limit?: number } = {}): Promise<Memory[]> {
	const db = getDb();
	const { wing, room, limit = 100 } = options;

	const filters: string[] = [];
	if (wing) filters.push(`wing = "${wing}"`);
	if (room) filters.push(`room = "${room}"`);

	const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

	const results = await db.query<MemoryRecord[]>(
		`SELECT * FROM memory ${whereClause} ORDER BY timestamp DESC LIMIT ${limit};`,
	);

	if (!results) {
		return [];
	}

	return results.map(row => toMemory(row));
}

/**
 * Count total memories in the database or within a filter.
 */
export async function countMemories(options: { wing?: string; room?: string } = {}): Promise<number> {
	const db = getDb();
	const { wing, room } = options;

	const filters: string[] = [];
	if (wing) filters.push(`wing = "${wing}"`);
	if (room) filters.push(`room = "${room}"`);

	const whereClause = filters.length > 0 ? `WHERE ${filters.join(" AND ")}` : "";

	// Use array::len approach for reliable counting
	const subquery = `SELECT * FROM memory ${whereClause}`;
	const queryResults = await db.query<Array<{ "array::len": number }>>(
		`SELECT array::len((${subquery})) FROM memory LIMIT 1;`,
	);

	// Query results are nested arrays: [[{count: n}]]
	const results = queryResults as unknown[];
	if (Array.isArray(results) && results.length > 0) {
		const first = results[0];
		if (Array.isArray(first) && first.length > 0) {
			const item = first[0] as { "array::len": number };
			return item["array::len"] ?? 0;
		}
	}

	return 0;
}

/**
 * Batch insert multiple memories efficiently.
 *
 * @param inputs - Array of memory inputs.
 * @returns Array of created memory records.
 */
export async function addMemories(inputs: MemoryInput[]): Promise<Memory[]> {
	const db = getDb();
	const now = new Date();

	const records = inputs.map(input => ({
		text: input.text,
		embedding: toSurrealArray(input.embedding),
		wing: input.wing,
		room: input.room,
		source: input.source,
		timestamp: now,
	}));

	const created = await db.insert<MemoryRecord>(MEMORY_TABLE, records);

	logger.debug("Memories batch inserted", { count: created.length });

	return created.map((record, index) =>
		toMemory({
			...record,
			embedding: Array.from(inputs[index].embedding),
		}),
	);
}
