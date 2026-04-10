/**
 * Entity Registry for MemPalace Knowledge Graph.
 *
 * Persistent storage and management of known entities.
 * Provides CRUD operations, confidence updates, and
 * context-aware disambiguation.
 */

import { Table, StringRecordId } from "surrealdb";
import { getDb } from "../broker";
import { logger } from "../logger";
import { type KgEntity, type EntityCandidate, type EntityType, CONFIDENCE_LEVELS } from "./types";

/** Entity table reference */
const ENTITY_TABLE = new Table("entity");

/** Entity record as stored in SurrealDB */
interface EntityRecord {
	id: string;
	name: string;
	type: string;
	confidence: number;
	observation_count: number;
	first_seen: Date | string;
	last_seen: Date | string;
	metadata: Record<string, unknown>;
}

/**
 * Convert a raw entity record to KgEntity.
 */
function toEntity(record: unknown): KgEntity {
	const r = record as EntityRecord;
	return {
		id: String(r.id),
		name: r.name,
		type: r.type as EntityType,
		confidence: r.confidence,
		observationCount: r.observation_count,
		firstSeen: r.first_seen instanceof Date ? r.first_seen : new Date(r.first_seen),
		lastSeen: r.last_seen instanceof Date ? r.last_seen : new Date(r.last_seen),
		metadata: r.metadata || {},
	};
}

/**
 * Convert a candidate to entity record format.
 */
function candidateToRecord(candidate: EntityCandidate): Omit<EntityRecord, "id"> {
	return {
		name: candidate.normalizedName,
		type: candidate.type,
		confidence: candidate.confidence,
		observation_count: 1,
		first_seen: new Date(),
		last_seen: new Date(),
		metadata: {
			surface_forms: [candidate.surfaceForm],
			last_context: candidate.context,
		},
	};
}

/**
 * Add a new entity to the registry.
 *
 * @param candidate - Entity candidate to register.
 * @returns The registered entity.
 */
export async function addEntity(candidate: EntityCandidate): Promise<KgEntity> {
	const db = getDb();

	const record = await db.insert<EntityRecord>(ENTITY_TABLE, candidateToRecord(candidate));

	logger.debug("Entity registered", {
		name: candidate.normalizedName,
		type: candidate.type,
		confidence: candidate.confidence,
	});

	return toEntity(record[0]);
}

/**
 * Get an entity by name (normalized).
 *
 * @param name - Normalized entity name.
 * @returns The entity or null if not found.
 */
export async function getEntity(name: string): Promise<KgEntity | null> {
	const db = getDb();
	const normalized = name.toLowerCase().trim();

	const results = await db.query<EntityRecord[]>(`SELECT * FROM entity WHERE name = $name LIMIT 1;`, {
		name: normalized,
	});

	if (!results || results.length === 0) {
		return null;
	}

	return toEntity(results[0]);
}

/**
 * Get an entity by ID.
 *
 * @param id - Entity record ID.
 * @returns The entity or null if not found.
 */
export async function getEntityById(id: string): Promise<KgEntity | null> {
	const db = getDb();

	try {
		const record = await db.select<EntityRecord>(new StringRecordId(id));
		return record ? toEntity(record) : null;
	} catch {
		return null;
	}
}

/**
 * Update an entity's observation count and confidence.
 *
 * Confidence is recalculated based on observation frequency
 * and recency.
 *
 * @param name - Normalized entity name.
 * @param context - New context where entity was observed.
 * @param additionalConfidence - Confidence boost from this observation.
 * @returns Updated entity or null if not found.
 */
export async function updateEntityObservation(
	name: string,
	context?: string,
	additionalConfidence = 0.1,
): Promise<KgEntity | null> {
	const db = getDb();
	const normalized = name.toLowerCase().trim();

	const existing = await getEntity(normalized);
	if (!existing) {
		return null;
	}

	// Calculate new confidence using exponential moving average
	// Weight recent observations more heavily
	const decayFactor = 0.9;
	const newConfidence = existing.confidence * decayFactor + additionalConfidence * (1 - decayFactor);

	// Update metadata with new surface form if provided
	const metadata = { ...existing.metadata };
	if (context) {
		metadata.last_context = context;
		const surfaceForms = (metadata.surface_forms as string[] | undefined) || [];
		if (!surfaceForms.includes(normalized)) {
			surfaceForms.push(normalized);
			metadata.surface_forms = surfaceForms.slice(-10); // Keep last 10
		}
	}

	const updated = await db.update<EntityRecord>(new StringRecordId(existing.id)).content({
		confidence: Math.min(1, newConfidence),
		observation_count: existing.observationCount + 1,
		last_seen: new Date(),
		metadata,
	});

	logger.debug("Entity observation updated", {
		name: normalized,
		observationCount: existing.observationCount + 1,
		newConfidence: Math.round(newConfidence * 100) / 100,
	});

	return toEntity(updated);
}

/**
 * Register or update an entity from a candidate.
 *
 * If the entity exists, updates observation count.
 * If new, creates the entity.
 *
 * @param candidate - Entity candidate to upsert.
 * @returns The registered or updated entity.
 */
export async function upsertEntity(candidate: EntityCandidate): Promise<KgEntity> {
	const existing = await getEntity(candidate.normalizedName);

	if (existing) {
		const updated = await updateEntityObservation(candidate.normalizedName, candidate.context, candidate.confidence);
		return updated!;
	}

	return addEntity(candidate);
}

/**
 * List all entities, optionally filtered by type or confidence.
 *
 * @param options - Filter options.
 * @returns Matching entities sorted by confidence.
 */
export async function listEntities(
	options: { type?: EntityType; minConfidence?: number; limit?: number } = {},
): Promise<KgEntity[]> {
	const db = getDb();
	const { type, minConfidence = 0, limit = 100 } = options;

	let query = `SELECT * FROM entity WHERE confidence >= $minConfidence`;
	const params: Record<string, unknown> = { minConfidence };

	if (type) {
		query += ` AND type = $type`;
		params.type = type;
	}

	query += ` ORDER BY confidence DESC LIMIT $limit`;
	params.limit = limit;

	const results = await db.query<EntityRecord[]>(query, params);

	if (!results) {
		return [];
	}

	return results.map(toEntity);
}

/**
 * Delete an entity by name.
 *
 * @param name - Normalized entity name.
 * @returns True if deleted, false if not found.
 */
export async function deleteEntity(name: string): Promise<boolean> {
	const db = getDb();
	const normalized = name.toLowerCase().trim();

	const results = await db.query<EntityRecord[]>(`SELECT id FROM entity WHERE name = $name LIMIT 1;`, {
		name: normalized,
	});

	if (!results || results.length === 0) {
		return false;
	}

	await db.delete(new StringRecordId(results[0].id));
	logger.debug("Entity deleted", { name: normalized });

	return true;
}

/**
 * Search for entities by name prefix.
 *
 * @param prefix - Name prefix to search.
 * @param limit - Maximum results.
 * @returns Matching entities.
 */
export async function searchEntities(prefix: string, limit = 20): Promise<KgEntity[]> {
	const db = getDb();
	const normalizedPrefix = prefix.toLowerCase().trim();

	const results = await db.query<EntityRecord[]>(
		`SELECT * FROM entity WHERE name CONTAINS $prefix ORDER BY confidence DESC LIMIT $limit;`,
		{ prefix: normalizedPrefix, limit },
	);

	if (!results) {
		return [];
	}

	return results.map(toEntity);
}

/**
 * Merge two entities into one.
 *
 * When two entities are identified as the same, merge their
 * data and update all references.
 *
 * @param sourceName - Entity to merge from (will be deleted).
 * @param targetName - Entity to merge into.
 * @returns The merged entity.
 */
export async function mergeEntities(sourceName: string, targetName: string): Promise<KgEntity> {
	const db = getDb();
	const normalizedSource = sourceName.toLowerCase().trim();
	const normalizedTarget = targetName.toLowerCase().trim();

	// Get both entities
	const [source, target] = await Promise.all([getEntity(normalizedSource), getEntity(normalizedTarget)]);

	if (!source) {
		throw new Error(`Source entity not found: ${normalizedSource}`);
	}
	if (!target) {
		throw new Error(`Target entity not found: ${normalizedTarget}`);
	}

	// Merge metadata
	const mergedMetadata = {
		...target.metadata,
		...source.metadata,
		merged_from: normalizedSource,
	};

	// Update target with merged data
	const combinedConfidence = Math.max(target.confidence, source.confidence);
	const combinedObservations = target.observationCount + source.observationCount;
	const earliestFirstSeen = source.firstSeen < target.firstSeen ? source.firstSeen : target.firstSeen;

	const updated = await db.update<EntityRecord>(new StringRecordId(target.id)).content({
		confidence: combinedConfidence,
		observation_count: combinedObservations,
		first_seen: earliestFirstSeen,
		metadata: mergedMetadata,
	});

	// Update all edges that reference the source entity
	// Note: This requires knowing the edge table structure
	const edgeTables = [
		"child_of",
		"likes",
		"works_on",
		"knows",
		"created",
		"member_of",
		"uses",
		"depends_on",
		"related_to",
		"implements",
	];

	for (const table of edgeTables) {
		// Update edges where source is the 'in' field
		await db.query(`UPDATE ${table} SET in = $newId WHERE in = $oldId;`, { oldId: source.id, newId: target.id });

		// Update edges where source is the 'out' field
		await db.query(`UPDATE ${table} SET out = $newId WHERE out = $oldId;`, { oldId: source.id, newId: target.id });
	}

	// Delete the source entity
	await db.delete(new StringRecordId(source.id));

	logger.info("Entities merged", {
		source: normalizedSource,
		target: normalizedTarget,
		combinedObservations,
	});

	return toEntity(updated);
}

/**
 * Get entity statistics.
 */
export async function getEntityStats(): Promise<{
	total: number;
	byType: Record<string, number>;
	highConfidence: number;
	averageConfidence: number;
}> {
	const db = getDb();

	const results = await db.query<
		Array<{
			total: number;
			byType: Record<string, number>;
			highConfidence: number;
			averageConfidence: number;
		}>
	>(
		`SELECT
			count() as total,
			array::len((
				SELECT type FROM entity GROUP BY type
			)) as typeCount,
			array::len((
				SELECT * FROM entity WHERE confidence >= $high
			)) as highConfidence,
			math::mean(confidence) as averageConfidence
		FROM entity GROUP ALL;`,
		{ high: CONFIDENCE_LEVELS.HIGH },
	);

	if (!results || results.length === 0) {
		return { total: 0, byType: {}, highConfidence: 0, averageConfidence: 0 };
	}

	const r = results[0];
	return {
		total: r.total ?? 0,
		byType: r.byType ?? {},
		highConfidence: r.highConfidence ?? 0,
		averageConfidence: r.averageConfidence ?? 0,
	};
}
