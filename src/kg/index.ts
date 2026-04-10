/**
 * Knowledge Graph Module for MemPalace.
 *
 * Unified API for entity detection, entity registry, triple storage,
 * and palace navigation graph.
 *
 * @example
 * ```typescript
 * import {
 *   detectEntities,
 *   addEntity,
 *   addTriple,
 *   queryEntity,
 *   queryRelationship,
 *   timeline,
 *   buildPalaceGraph,
 *   traverseRooms,
 * } from "pi-mempalace/kg";
 *
 * // Detect entities in text
 * const entities = detectEntities("John works on pi-mempalace using TypeScript");
 *
 * // Register an entity
 * const entity = await addEntity(entities[0]);
 *
 * // Add a relationship
 * const triple = await addTriple({
 *   subject: "john",
 *   predicate: "works_on",
 *   object: "pi-mempalace",
 * });
 *
 * // Query all facts about an entity
 * const facts = await queryEntity("pi-mempalace");
 *
 * // Get timeline of events
 * const events = await timeline({ limit: 20 });
 *
 * // Navigate the palace
 * const graph = await buildPalaceGraph();
 * const rooms = await traverseRooms("work:backend");
 * ```
 */

// Re-export entity detection
export {
	detectEntities,
	extractCandidates,
	scoreCandidates,
	extractEntitiesWithRelationships,
	normalizeEntityName,
} from "./entity-detector";

// Re-export entity registry
export {
	addEntity,
	getEntity,
	getEntityById,
	upsertEntity,
	updateEntityObservation,
	listEntities,
	searchEntities,
	deleteEntity,
	mergeEntities,
	getEntityStats,
} from "./entity-registry";

// Re-export graph operations
export {
	addTriple,
	queryEntity,
	queryRelationship,
	timeline,
	extractTriplesFromText,
	expireTriple,
	countTriples,
} from "./graph";

// Re-export palace graph
export {
	buildPalaceGraph,
	traverseRooms,
	findPath,
	getTunnels,
	getPalaceStats,
	getCachedPalaceGraph,
	invalidatePalaceGraph,
} from "./palace-graph";

// Re-export types
export type {
	EntityCandidate,
	EntityType,
	KgEntity,
	KgEdgeType,
	Triple,
	TripleInput,
	PalaceRoom,
	PalaceNode,
	TimelineEntry,
	TimelineOptions,
	TraversalOptions,
} from "./types";

// Re-export constants
export {
	ENTITY_TYPES,
	KG_EDGE_TYPES,
	CONFIDENCE_LEVELS,
} from "./types";
