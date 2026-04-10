/**
 * Tests for MemPalace core storage layer.
 *
 * These tests verify the basic functionality of:
 * - Database initialization
 * - Memory CRUD operations
 * - Embedding generation
 */

import { describe, it, expect, beforeAll, afterAll } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

// Test database path
const testDir = path.join(os.tmpdir(), `mempalace-test-${Date.now()}`);
const _testDbPath = path.join(testDir, "db");

async function cleanupTestDir() {
	try {
		await fs.rm(testDir, { recursive: true, force: true });
	} catch {
		// Ignore cleanup errors
	}
}

describe("MemPalace Core Storage", () => {
	// These tests require actual database and embedding model initialization
	// Skip in CI or when dependencies are not available

	describe("Types and Constants", () => {
		it("should export correct HNSW configuration", async () => {
			const { HNSW_CONFIG } = await import("../src/types");
			expect(HNSW_CONFIG.DIMENSION).toBe(384);
			expect(HNSW_CONFIG.DISTANCE).toBe("COSINE");
			expect(HNSW_CONFIG.EFC).toBe(150);
			expect(HNSW_CONFIG.M).toBe(16);
		});

		it("should export correct embedding configuration", async () => {
			const { EMBEDDING_CONFIG } = await import("../src/types");
			expect(EMBEDDING_CONFIG.DIMENSION).toBe(384);
			expect(EMBEDDING_CONFIG.MODEL).toBe("Xenova/all-MiniLM-L6-v2");
		});

		it("should export correct paths", async () => {
			const { PATHS } = await import("../src/types");
			expect(PATHS.DEFAULT_DATA_DIR).toBe(".mempalace");
			expect(PATHS.DATABASE_DIR).toBe("db");
		});

		it("should export edge types", async () => {
			const { EDGE_TYPES } = await import("../src/types");
			expect(EDGE_TYPES.CHILD_OF).toBe("child_of");
			expect(EDGE_TYPES.LIKES).toBe("likes");
			expect(EDGE_TYPES.WORKS_ON).toBe("works_on");
			expect(EDGE_TYPES.KNOWS).toBe("knows");
			expect(EDGE_TYPES.CREATED).toBe("created");
			expect(EDGE_TYPES.MEMBER_OF).toBe("member_of");
		});
	});

	describe("Database Initialization", () => {
		it("should initialize database in test directory", async () => {
			const { connectDb, closeDb, getDataDir, isDbInitialized } = await import("../src/broker");

			await fs.mkdir(testDir, { recursive: true });
			await connectDb({ dataDir: testDir });

			expect(isDbInitialized()).toBe(true);
			expect(getDataDir()).toBe(testDir);

			await closeDb();
			await cleanupTestDir();
		});

		it("should throw if database not initialized", async () => {
			const { getDb, closeDb } = await import("../src/broker");

			// Ensure db is closed
			await closeDb();

			expect(() => getDb()).toThrow("MemPalace not initialized");
		});
	});

	describe("Utility Functions", () => {
		it("should convert embeddings to surreal arrays", async () => {
			const { toSurrealArray, fromSurrealArray } = await import("../src/db");

			const original = new Float32Array([1.0, 2.0, 3.0]);
			const surrealArray = toSurrealArray(original);

			expect(Array.isArray(surrealArray)).toBe(true);
			expect(surrealArray).toEqual([1.0, 2.0, 3.0]);

			const recovered = fromSurrealArray(surrealArray);
			expect(recovered).toBeInstanceOf(Float32Array);
			expect(Array.from(recovered)).toEqual([1.0, 2.0, 3.0]);
		});

		it("should create valid surreal vector string", async () => {
			const { toSurrealVector } = await import("../src/db");

			const embedding = new Float32Array([1.0, 2.0, 3.0]);
			const vectorStr = toSurrealVector(embedding);

			expect(vectorStr).toBe("[1,2,3]");
		});
	});

	describe("Memory Operations", () => {
		beforeAll(async () => {
			await fs.mkdir(testDir, { recursive: true });
			const { connectDb } = await import("../src/broker");
			await connectDb({ dataDir: testDir });
		});

		afterAll(async () => {
			const { closeDb } = await import("../src/broker");
			await closeDb();
			await cleanupTestDir();
		});

		it("should add a memory", async () => {
			const { addMemory } = await import("../src/memory");

			const embedding = new Float32Array(384);
			embedding[0] = 1.0;
			embedding[1] = 0.5;

			const memory = await addMemory({
				text: "Test memory content",
				embedding,
				wing: "test-wing",
				room: "test-room",
				source: "test-source",
			});

			expect(memory.id).toBeDefined();
			expect(memory.text).toBe("Test memory content");
			expect(memory.wing).toBe("test-wing");
			expect(memory.room).toBe("test-room");
			expect(memory.source).toBe("test-source");
			expect(memory.embedding).toBeInstanceOf(Float32Array);
			expect(memory.timestamp).toBeInstanceOf(Date);
		});

		it("should retrieve a memory by id", async () => {
			const { addMemory, getMemory } = await import("../src/memory");

			const embedding = new Float32Array(384);
			embedding[0] = 0.9;

			const created = await addMemory({
				text: "Retrieve test",
				embedding,
				wing: "retrieve-wing",
				room: "retrieve-room",
				source: "retrieve-source",
			});

			const retrieved = await getMemory(created.id);

			expect(retrieved).not.toBeNull();
			expect(retrieved!.id).toBe(created.id);
			expect(retrieved!.text).toBe("Retrieve test");
		});

		it("should delete a memory", async () => {
			const { addMemory, deleteMemory, getMemory } = await import("../src/memory");

			const embedding = new Float32Array(384);
			embedding[0] = 0.8;

			const created = await addMemory({
				text: "Delete test",
				embedding,
				wing: "delete-wing",
				room: "delete-room",
				source: "delete-source",
			});

			const deleted = await deleteMemory(created.id);
			expect(deleted).toBe(true);

			const retrieved = await getMemory(created.id);
			expect(retrieved).toBeNull();
		});

		it("should count memories", async () => {
			const { countMemories, addMemory } = await import("../src/memory");

			const initialCount = await countMemories();

			const embedding = new Float32Array(384);
			embedding[0] = 0.7;

			await addMemory({
				text: "Count test 1",
				embedding,
				wing: "count-wing",
				room: "count-room",
				source: "count-source",
			});

			await addMemory({
				text: "Count test 2",
				embedding,
				wing: "count-wing",
				room: "count-room",
				source: "count-source",
			});

			const finalCount = await countMemories();
			expect(finalCount).toBeGreaterThanOrEqual(initialCount + 2);
		});
	});

	describe("Embedding Generation", () => {
		it("should validate embedding dimension", async () => {
			const { validateEmbedding } = await import("../src/embed");

			const validEmbedding = new Float32Array(384);
			expect(validateEmbedding(validEmbedding)).toBe(true);

			const invalidEmbedding = new Float32Array(128);
			expect(validateEmbedding(invalidEmbedding)).toBe(false);
		});

		it("should report embed readiness status", async () => {
			const { isEmbedReady } = await import("../src/embed");
			// Pipeline is not loaded initially
			expect(typeof isEmbedReady()).toBe("boolean");
		});
	});

	describe("Public API Exports", () => {
		it("should export all public functions", async () => {
			const api = await import("../src/index");

			// Database lifecycle
			expect(typeof api.initDb).toBe("function");
			expect(typeof api.closeDb).toBe("function");
			expect(typeof api.getDb).toBe("function");
			expect(typeof api.getDataDir).toBe("function");
			expect(typeof api.isDbInitialized).toBe("function");

			// Memory operations
			expect(typeof api.addMemory).toBe("function");
			expect(typeof api.upsertMemory).toBe("function");
			expect(typeof api.deleteMemory).toBe("function");
			expect(typeof api.getMemory).toBe("function");
			expect(typeof api.queryMemories).toBe("function");
			expect(typeof api.listMemories).toBe("function");
			expect(typeof api.countMemories).toBe("function");
			expect(typeof api.addMemories).toBe("function");

			// Embedding
			expect(typeof api.embed).toBe("function");
			expect(typeof api.embedBatch).toBe("function");
			expect(typeof api.isEmbedReady).toBe("function");
			expect(typeof api.unloadEmbed).toBe("function");
			expect(typeof api.validateEmbedding).toBe("function");

			// Convenience functions
			expect(typeof api.init).toBe("function");
			expect(typeof api.close).toBe("function");
		});

		it("should export types", async () => {
			const types = await import("../src/types");

			// Check that type exports exist
			expect("HNSW_CONFIG" in types).toBe(true);
			expect("EMBEDDING_CONFIG" in types).toBe(true);
			expect("PATHS" in types).toBe(true);
			expect("EDGE_TYPES" in types).toBe(true);
		});
	});
});
