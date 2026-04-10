/**
 * Knowledge Graph Operations for MemPalace.
 *
 * Provides triple storage, retrieval, and temporal versioning
 * using SurrealDB's edge records and VERSION syntax.
 */

import { StringRecordId } from "surrealdb";
import { getDb } from "../broker";
import { logger } from "../logger";
import { getEntity, upsertEntity } from "./entity-registry";
import { extractEntitiesWithRelationships } from "./entity-detector";
import type { EntityCandidate } from "./types";
import {
	type Triple,
	type TripleInput,
	type KgEdgeType,
	type TimelineEntry,
	type TimelineOptions,
	KG_EDGE_TYPES,
	CONFIDENCE_LEVELS,
} from "./types";

/** SurrealDB edge record format */
interface EdgeRecord {
	id: string;
	in: string;
	out: string;
	edge_type: string;
	since: Date | string;
	valid_to: Date | string | null;
	source_memory: string;
	confidence: number;
}

/** Triple table mapping */
const EDGE_TABLES: Record<KgEdgeType, string> = {
	[KG_EDGE_TYPES.CHILD_OF]: "child_of",
	[KG_EDGE_TYPES.LIKES]: "likes",
	[KG_EDGE_TYPES.WORKS_ON]: "works_on",
	[KG_EDGE_TYPES.KNOWS]: "knows",
	[KG_EDGE_TYPES.CREATED]: "created",
	[KG_EDGE_TYPES.MEMBER_OF]: "member_of",
	[KG_EDGE_TYPES.USES]: "uses",
	[KG_EDGE_TYPES.DEPENDS_ON]: "depends_on",
	[KG_EDGE_TYPES.RELATED_TO]: "related_to",
	[KG_EDGE_TYPES.IMPLEMENTS]: "implements",
};

/**
 * Convert an edge record to a Triple.
 */
function toTriple(record: unknown, subject: string, object: string): Triple {
	const r = record as EdgeRecord;
	return {
		id: String(r.id),
		subject,
		predicate: r.edge_type as KgEdgeType,
		object,
		validFrom: r.since instanceof Date ? r.since : new Date(r.since),
		validTo: r.valid_to ? (r.valid_to instanceof Date ? r.valid_to : new Date(r.valid_to)) : null,
		sourceMemory: r.source_memory || "",
		confidence: r.confidence ?? CONFIDENCE_LEVELS.MEDIUM,
	};
}

/**
 * Get the entity ID for a name.
 * Creates the entity if it doesn't exist.
 */
async function resolveEntityId(name: string): Promise<string> {
	const normalized = name.toLowerCase().trim();
	const entity = await getEntity(normalized);

	if (entity) {
		return entity.id;
	}

	// Create a placeholder entity
	const candidate: EntityCandidate = {
		surfaceForm: normalized,
		normalizedName: normalized,
		type: "conceptual",
		confidence: CONFIDENCE_LEVELS.LOW,
		context: "",
		startIndex: 0,
		endIndex: 0,
	};

	const created = await upsertEntity(candidate);
	return created.id;
}

/**
 * Add a triple (subject, predicate, object) to the knowledge graph.
 *
 * Uses RELATE to create a SurrealDB edge record with temporal metadata.
 *
 * @param input - Triple to add.
 * @returns The created triple.
 */
export async function addTriple(input: TripleInput): Promise<Triple> {
	const db = getDb();
	const { subject, predicate, object, sourceMemory = "", confidence = CONFIDENCE_LEVELS.MEDIUM } = input;

	// Resolve entity IDs
	const [subjectId, objectId] = await Promise.all([resolveEntityId(subject), resolveEntityId(object)]);

	const tableName = EDGE_TABLES[predicate];
	if (!tableName) {
		throw new Error(`Unknown edge type: ${predicate}`);
	}

	// Create the edge using RELATE
	const now = new Date();
	const result = await db.query<EdgeRecord[]>(
		`RELATE ${subjectId} -> ${tableName} -> ${objectId}
		 SET since = $since,
			 valid_to = null,
			 source_memory = $source,
			 confidence = $confidence
		 RETURN AFTER;`,
		{
			since: now.toISOString(),
			source: sourceMemory,
			confidence,
		},
	);

	if (!result || result.length === 0) {
		throw new Error("Failed to create triple");
	}

	logger.debug("Triple added", { subject, predicate, object });

	return toTriple(result[0], subject, object);
}

/**
 * Query all facts about an entity.
 *
 * Returns both incoming and outgoing relationships.
 *
 * @param name - Entity name to query.
 * @param asOf - Optional timestamp for temporal query.
 * @returns All triples involving this entity.
 */
export async function queryEntity(name: string, asOf?: Date): Promise<Triple[]> {
	const db = getDb();
	const normalized = name.toLowerCase().trim();

	// Get the entity first
	const entity = await getEntity(normalized);
	if (!entity) {
		return [];
	}

	const triples: Triple[] = [];
	const versionClause = asOf ? `VERSION "${asOf.toISOString()}"` : "";

	// Query outgoing edges
	for (const [_predicate, table] of Object.entries(EDGE_TABLES)) {
		const query = versionClause
			? `SELECT * FROM ${table} WHERE in = $entityId ${versionClause};`
			: `SELECT * FROM ${table} WHERE in = $entityId;`;

		const results = await db.query<EdgeRecord[]>(query, { entityId: entity.id });

		if (results && results.length > 0) {
			for (const r of results) {
				// Get the object entity name
				const objEntity = await getEntity(r.out);
				const objName = objEntity?.name ?? r.out;
				triples.push(toTriple(r, normalized, objName));
			}
		}
	}

	// Query incoming edges
	for (const [_predicate, table] of Object.entries(EDGE_TABLES)) {
		const query = versionClause
			? `SELECT * FROM ${table} WHERE out = $entityId ${versionClause};`
			: `SELECT * FROM ${table} WHERE out = $entityId;`;

		const results = await db.query<EdgeRecord[]>(query, { entityId: entity.id });

		if (results && results.length > 0) {
			for (const r of results) {
				// Get the subject entity name
				const subEntity = await getEntity(r.in);
				const subName = subEntity?.name ?? r.in;
				// Reverse the predicate for incoming edges
				triples.push(toTriple(r, subName, normalized));
			}
		}
	}

	// Sort by validity (most recent first)
	triples.sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime());

	return triples;
}

/**
 * Query all triples of a specific relationship type.
 *
 * @param edgeType - The edge type to query.
 * @param options - Optional filters.
 * @returns All triples of the specified type.
 */
export async function queryRelationship(
	edgeType: KgEdgeType,
	options: {
		subject?: string;
		object?: string;
		limit?: number;
	} = {},
): Promise<Triple[]> {
	const db = getDb();
	const { subject, object, limit = 100 } = options;

	const tableName = EDGE_TABLES[edgeType];
	if (!tableName) {
		throw new Error(`Unknown edge type: ${edgeType}`);
	}

	let query = `SELECT * FROM ${tableName}`;
	const conditions: string[] = [];
	const params: Record<string, unknown> = { limit };

	if (subject) {
		const entity = await getEntity(subject.toLowerCase().trim());
		if (entity) {
			conditions.push(`in = $subjectId`);
			params.subjectId = entity.id;
		}
	}

	if (object) {
		const entity = await getEntity(object.toLowerCase().trim());
		if (entity) {
			conditions.push(`out = $objectId`);
			params.objectId = entity.id;
		}
	}

	if (conditions.length > 0) {
		query += ` WHERE ${conditions.join(" AND ")}`;
	}

	query += ` LIMIT $limit;`;

	const results = await db.query<EdgeRecord[]>(query, params);

	if (!results) {
		return [];
	}

	const triples: Triple[] = [];
	for (const r of results) {
		const subEntity = await getEntity(r.in);
		const objEntity = await getEntity(r.out);
		triples.push(toTriple(r, subEntity?.name ?? r.in, objEntity?.name ?? r.out));
	}

	return triples;
}

/**
 * Get the timeline of events for an entity or all entities.
 *
 * @param options - Timeline query options.
 * @returns Chronological list of events.
 */
export async function timeline(options: TimelineOptions = {}): Promise<TimelineEntry[]> {
	const db = getDb();
	const { entity, since, until, limit = 100, eventTypes } = options;

	const entries: TimelineEntry[] = [];

	// Build date filters
	const dateFilters: string[] = [];
	if (since) {
		dateFilters.push(`since >= "${since.toISOString()}"`);
	}
	if (until) {
		dateFilters.push(`since <= "${until.toISOString()}"`);
	}
	const whereClause = dateFilters.length > 0 ? `WHERE ${dateFilters.join(" AND ")}` : "";

	// Collect triples from all edge tables
	for (const [predicate, table] of Object.entries(EDGE_TABLES)) {
		const query = `SELECT * FROM ${table} ${whereClause} ORDER BY since DESC LIMIT ${limit};`;
		const results = await db.query<EdgeRecord[]>(query);

		if (results && results.length > 0) {
			for (const r of results) {
				const subEntity = await getEntity(r.in);
				const objEntity = await getEntity(r.out);
				const subName = subEntity?.name ?? r.in;
				const objName = objEntity?.name ?? r.out;

				// Filter by entity if specified
				if (entity) {
					const normalizedEntity = entity.toLowerCase().trim();
					if (subName.toLowerCase() !== normalizedEntity && objName.toLowerCase() !== normalizedEntity) {
						continue;
					}
				}

				entries.push({
					timestamp: r.since instanceof Date ? r.since : new Date(r.since),
					eventType: `triple_${predicate}`,
					description: `${subName} ${predicate} ${objName}`,
					entities: [subName, objName],
				});
			}
		}
	}

	// Filter by event types if specified
	let filtered = entries;
	if (eventTypes && eventTypes.length > 0) {
		filtered = entries.filter(e => eventTypes.includes(e.eventType));
	}

	// Sort by timestamp descending
	filtered.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

	// Apply limit
	return filtered.slice(0, limit);
}

/**
 * Extract and store triples from text.
 *
 * Detects entities and their co-occurrences in the text,
 * then creates triples for related entities.
 *
 * @param text - Source text to analyze.
 * @param sourceMemory - Optional source memory ID for provenance.
 * @returns Extracted entities and triples.
 */
export async function extractTriplesFromText(
	text: string,
	sourceMemory?: string,
): Promise<{
	entities: EntityCandidate[];
	triples: Triple[];
}> {
	const { entities, relationships } = await extractEntitiesWithRelationships(text);

	// Store entities
	const storedEntities: EntityCandidate[] = [];
	for (const candidate of entities) {
		const _stored = await upsertEntity(candidate);
		storedEntities.push(candidate);
	}

	// Create triples for co-occurring entities
	const triples: Triple[] = [];
	const processedPairs = new Set<string>();

	for (const rel of relationships) {
		// Create a unique key for this pair (to avoid duplicates)
		const pairKey = `${rel.subject}||${rel.object}`;
		const reversePairKey = `${rel.object}||${rel.subject}`;

		if (processedPairs.has(pairKey) || processedPairs.has(reversePairKey)) {
			continue;
		}
		processedPairs.add(pairKey);

		try {
			const triple = await addTriple({
				subject: rel.subject,
				predicate: KG_EDGE_TYPES.RELATED_TO,
				object: rel.object,
				sourceMemory: sourceMemory ?? rel.context,
				confidence: CONFIDENCE_LEVELS.MEDIUM,
			});
			triples.push(triple);
		} catch (err) {
			logger.warn("Failed to create triple", { error: String(err), subject: rel.subject, object: rel.object });
		}
	}

	return { entities: storedEntities, triples };
}

/**
 * Expire a triple (soft delete).
 *
 * Sets valid_to to current time instead of deleting the record.
 *
 * @param tripleId - ID of the triple to expire.
 * @returns The expired triple.
 */
export async function expireTriple(tripleId: string): Promise<Triple | null> {
	const db = getDb();

	try {
		const recordId = new StringRecordId(tripleId);
		const now = new Date();

		const updated = await db.update<EdgeRecord>(recordId).content({
			valid_to: now.toISOString(),
		});

		if (!updated) {
			return null;
		}

		// Get the entity names for the triple
		const subEntity = await getEntity(updated.in);
		const objEntity = await getEntity(updated.out);

		logger.debug("Triple expired", { id: tripleId });

		return toTriple(updated, subEntity?.name ?? updated.in, objEntity?.name ?? updated.out);
	} catch {
		return null;
	}
}

/**
 * Count triples in the knowledge graph.
 */
export async function countTriples(
	options: { edgeType?: KgEdgeType; subject?: string; object?: string } = {},
): Promise<number> {
	const db = getDb();
	const { edgeType, subject, object } = options;

	if (edgeType) {
		const tableName = EDGE_TABLES[edgeType];
		if (!tableName) {
			return 0;
		}

		let query = `SELECT count() as count FROM ${tableName}`;
		const conditions: string[] = [];
		const params: Record<string, unknown> = {};

		if (subject) {
			const entity = await getEntity(subject.toLowerCase().trim());
			if (entity) {
				conditions.push(`in = $subjectId`);
				params.subjectId = entity.id;
			}
		}

		if (object) {
			const entity = await getEntity(object.toLowerCase().trim());
			if (entity) {
				conditions.push(`out = $objectId`);
				params.objectId = entity.id;
			}
		}

		if (conditions.length > 0) {
			query += ` WHERE ${conditions.join(" AND ")}`;
		}

		query += " GROUP ALL;";

		const results = await db.query<Array<{ count: number }>>(query, params);
		return results?.[0]?.count ?? 0;
	}

	// Count across all edge types
	let total = 0;
	for (const table of Object.values(EDGE_TABLES)) {
		const results = await db.query<Array<{ count: number }>>(`SELECT count() as count FROM ${table} GROUP ALL;`);
		total += results?.[0]?.count ?? 0;
	}

	return total;
}

// Re-export for convenience
export { detectEntities, extractEntitiesWithRelationships } from "./entity-detector";
export { upsertEntity, getEntity, listEntities } from "./entity-registry";
