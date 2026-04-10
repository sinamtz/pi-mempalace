/**
 * Shared TypeScript interfaces for the MemPalace extension.
 *
 * These types define the core data structures used across the storage layer,
 * mining pipeline, and knowledge graph components.
 */

import type { RecordId } from "surrealdb";

/** A 384-dimensional embedding vector (all-MiniLM-L6-v2 output). */
export type Embedding = Float32Array;

/** Unique identifier for a memory record. */
export type MemoryId = string | RecordId;

/** Unique identifier for a person/entity record. */
export type PersonId = string | RecordId;

/**
 * A semantic memory record stored in SurrealDB.
 *
 * Memories are the atomic units of the memory palace — each represents
 * a chunk of text with its semantic embedding and spatial metadata.
 */
export interface Memory {
	/** Unique record ID (e.g., "memory:xxxxx"). */
	id: MemoryId;
	/** The raw text content of this memory. */
	text: string;
	/** 384-dimensional embedding vector (all-MiniLM-L6-v2). */
	embedding: Embedding;
	/** Wing identifier — high-level spatial division of the palace. */
	wing: string;
	/** Room identifier — specific location within a wing. */
	room: string;
	/** Source identifier — where this memory came from (file, conversation, etc.). */
	source: string;
	/** When this memory was created. */
	timestamp: Date;
}

/** Input for creating a new memory (without auto-generated fields). */
export interface MemoryInput {
	/** The raw text content. */
	text: string;
	/** The embedding vector. Generate with embed(). */
	embedding: Embedding;
	/** Wing identifier (e.g., "work", "personal", "project-x"). */
	wing: string;
	/** Room identifier within the wing. */
	room: string;
	/** Source identifier for provenance tracking. */
	source: string;
}

/** Input for updating an existing memory. */
export interface MemoryUpdate {
	/** Updated text content (optional). */
	text?: string;
	/** Updated embedding (optional, regenerate with embed()). */
	embedding?: Embedding;
	/** Updated wing (optional). */
	wing?: string;
	/** Updated room (optional). */
	room?: string;
	/** Updated source (optional). */
	source?: string;
}

/** A person or entity in the knowledge graph. */
export interface Person {
	/** Unique record ID (e.g., "person:max"). */
	id: PersonId;
	/** Display name of this entity. */
	name: string;
	/** Entity type (e.g., "person", "organization", "concept"). */
	type: string;
	/** Additional properties as key-value pairs. */
	properties: Record<string, unknown>;
}

/** Input for creating a new person entity. */
export interface PersonInput {
	/** Display name. */
	name: string;
	/** Entity type. */
	type: string;
	/** Additional properties. */
	properties?: Record<string, unknown>;
}

/**
 * Edge types for the knowledge graph.
 *
 * These define the relationship categories between entities.
 */
export const EDGE_TYPES = {
	CHILD_OF: "child_of",
	LIKES: "likes",
	WORKS_ON: "works_on",
	KNOWS: "knows",
	CREATED: "created",
	MEMBER_OF: "member_of",
} as const;

export type EdgeType = (typeof EDGE_TYPES)[keyof typeof EDGE_TYPES];

/**
 * An edge record linking two entities with a temporal timestamp.
 *
 * Edges are first-class records in SurrealDB, enabling temporal versioning.
 */
export interface Edge {
	/** Unique record ID. */
	id: PersonId;
	/** Source entity ID. */
	in: PersonId;
	/** Edge type. */
	edge_type: EdgeType;
	/** Target entity ID. */
	out: PersonId;
	/** When this relationship was established. */
	since: Date;
}

/** Input for creating a new edge. */
export interface EdgeInput {
	/** Source entity ID. */
	in: PersonId;
	/** Edge type. */
	edge_type: EdgeType;
	/** Target entity ID. */
	out: PersonId;
}

/**
 * Result of a vector similarity search.
 *
 * Combines the memory content with relevance metadata from the search.
 */
export interface MemoryResult {
	/** The matched memory record. */
	memory: Memory;
	/** Cosine similarity score (0-1, higher = more similar). */
	score: number;
}

/**
 * Options for querying memories with vector search.
 */
export interface QueryOptions {
	/** Maximum number of results to return. Default: 10. */
	limit?: number;
	/** Filter by wing (optional). */
	wing?: string;
	/** Filter by room (optional). */
	room?: string;
	/** Filter by source (optional). */
	source?: string;
	/** Minimum similarity score threshold (0-1). Default: 0.0. */
	minScore?: number;
}

/** HNSW index parameters for embedding field. */
export const HNSW_CONFIG = {
	/** Embedding dimension (all-MiniLM-L6-v2). */
	DIMENSION: 384,
	/** Distance metric. */
	DISTANCE: "COSINE" as const,
	/** Maximum number of elements in the dynamic candidate list. */
	EFC: 150,
	/** Number of bi-directional links created for each element. */
	M: 16,
} as const;

/** Configuration for the embedding model. */
export const EMBEDDING_CONFIG = {
	/** Model identifier for all-MiniLM-L6-v2. */
	MODEL: "Xenova/all-MiniLM-L6-v2",
	/** Expected embedding dimension. */
	DIMENSION: 384,
	/** Device to use for inference ("cpu" or "cuda"). */
	DEVICE: "cpu",
	/** Maximum text length in tokens (approximate). */
	MAX_LENGTH: 256,
} as const;

/** Default paths for MemPalace data storage. */
export const PATHS = {
	/** Default data directory under user's home. */
	DEFAULT_DATA_DIR: ".mempalace",
	/** SurrealDB data subdirectory. */
	DATABASE_DIR: "db",
} as const;
