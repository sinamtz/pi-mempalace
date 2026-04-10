/**
 * TypeScript interfaces for the Knowledge Graph module.
 *
 * Extends the core types.ts with KG-specific types for entities,
 * triples, and palace graph navigation.
 */

/** Entity types recognized by the detector. */
export const ENTITY_TYPES = {
	PERSON: "person",
	PROJECT: "project",
	TOOL: "tool",
	CONCEPT: "concept",
	ORGANIZATION: "organization",
	FILE: "file",
	CONCEPTUAL: "conceptual",
} as const;

export type EntityType = (typeof ENTITY_TYPES)[keyof typeof ENTITY_TYPES];

/** Extended edge types for KG operations. */
export const KG_EDGE_TYPES = {
	CHILD_OF: "child_of",
	LIKES: "likes",
	WORKS_ON: "works_on",
	KNOWS: "knows",
	CREATED: "created",
	MEMBER_OF: "member_of",
	USES: "uses",
	DEPENDS_ON: "depends_on",
	RELATED_TO: "related_to",
	IMPLEMENTS: "implements",
} as const;

export type KgEdgeType = (typeof KG_EDGE_TYPES)[keyof typeof KG_EDGE_TYPES];

/** Confidence level for entity detection. */
export const CONFIDENCE_LEVELS = {
	HIGH: 0.8,
	MEDIUM: 0.5,
	LOW: 0.3,
} as const;

/**
 * A detected entity candidate from text analysis.
 */
export interface EntityCandidate {
	/** The entity text as it appears in the source. */
	surfaceForm: string;
	/** Normalized/formatted name for storage. */
	normalizedName: string;
	/** Detected entity type. */
	type: EntityType;
	/** Detection confidence (0-1). */
	confidence: number;
	/** Context where the entity was found. */
	context: string;
	/** Character position in source text. */
	startIndex: number;
	/** End character position in source text. */
	endIndex: number;
}

/**
 * A registered entity in the knowledge graph.
 */
export interface KgEntity {
	/** Unique record ID. */
	id: string;
	/** Normalized display name. */
	name: string;
	/** Entity type. */
	type: EntityType;
	/** Confidence score based on observations. */
	confidence: number;
	/** Number of times this entity has been observed. */
	observationCount: number;
	/** When first observed. */
	firstSeen: Date;
	/** When last observed. */
	lastSeen: Date;
	/** Additional metadata. */
	metadata: Record<string, unknown>;
}

/**
 * A triple (subject, predicate, object) in the knowledge graph.
 */
export interface Triple {
	/** Unique record ID. */
	id: string;
	/** Subject entity name. */
	subject: string;
	/** Predicate/edge type. */
	predicate: KgEdgeType;
	/** Object entity name. */
	object: string;
	/** When this relationship was first observed. */
	validFrom: Date;
	/** When this relationship expired (null if current). */
	validTo: Date | null;
	/** Source memory/text that established this triple. */
	sourceMemory: string;
	/** Confidence score. */
	confidence: number;
}

/**
 * Input for creating a new triple.
 */
export interface TripleInput {
	/** Subject entity name. */
	subject: string;
	/** Predicate/edge type. */
	predicate: KgEdgeType;
	/** Object entity name. */
	object: string;
	/** Source memory that established this triple. */
	sourceMemory?: string;
	/** Initial confidence score. */
	confidence?: number;
}

/**
 * A room in the memory palace with navigation metadata.
 */
export interface PalaceRoom {
	/** Wing identifier. */
	wing: string;
	/** Room identifier. */
	room: string;
	/** Number of memories in this room. */
	memoryCount: number;
	/** Connected rooms via same wing. */
	adjacentRooms: string[];
	/** Connected rooms via tunnels (cross-wing). */
	tunnelRooms: string[];
	/** Primary themes/topics in this room. */
	themes: string[];
	/** Last activity timestamp. */
	lastActivity: Date;
}

/**
 * A node in the palace navigation graph.
 */
export interface PalaceNode {
	/** Unique identifier (wing:room). */
	id: string;
	/** Wing identifier. */
	wing: string;
	/** Room identifier. */
	room: string;
	/** Connected nodes by edge type. */
	connections: Map<string, { nodeId: string; type: "adjacent" | "tunnel" }>;
	/** Room metadata. */
	metadata: PalaceRoom;
}

/**
 * Result of timeline query.
 */
export interface TimelineEntry {
	/** When this event occurred. */
	timestamp: Date;
	/** Event type (memory_added, triple_created, entity_observed). */
	eventType: string;
	/** Description of the event. */
	description: string;
	/** Related entity names. */
	entities: string[];
	/** Source memory ID if applicable. */
	memoryId?: string;
}

/**
 * Options for timeline queries.
 */
export interface TimelineOptions {
	/** Filter by entity name. */
	entity?: string;
	/** Start date bound. */
	since?: Date;
	/** End date bound. */
	until?: Date;
	/** Maximum entries to return. */
	limit?: number;
	/** Event types to include. */
	eventTypes?: string[];
}

/**
 * Options for palace graph traversal.
 */
export interface TraversalOptions {
	/** Maximum depth to traverse. */
	maxDepth?: number;
	/** Starting wing/room. */
	start?: string;
	/** Edge types to follow. */
	edgeTypes?: ("adjacent" | "tunnel" | "all")[];
	/** Whether to include room metadata. */
	includeMetadata?: boolean;
}
