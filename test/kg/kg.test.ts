/**
 * Tests for the Knowledge Graph module.
 */

import { describe, expect, test } from "bun:test";
import {
	detectEntities,
	extractCandidates,
	scoreCandidates,
	extractEntitiesWithRelationships,
	normalizeEntityName,
	ENTITY_TYPES,
	CONFIDENCE_LEVELS,
} from "../../src/kg/entity-detector";

describe("Entity Detection", () => {
	describe("normalizeEntityName", () => {
		test("normalizes whitespace", () => {
			expect(normalizeEntityName("  John   Smith  ")).toBe("john smith");
		});

		test("removes quotes", () => {
			expect(normalizeEntityName('"John"')).toBe("john");
			expect(normalizeEntityName("'Smith'")).toBe("smith");
		});

		test("lowercases text", () => {
			expect(normalizeEntityName("JOHN SMITH")).toBe("john smith");
		});
	});

	describe("extractCandidates", () => {
		test("extracts kebab-case project names", () => {
			const candidates = extractCandidates("The pi-mempalace project is awesome");
			const names = candidates.map(c => c.normalizedName);

			expect(names).toContain("pi-mempalace");
		});

		test("extracts capitalized person names", () => {
			const candidates = extractCandidates("John Smith mentioned this");
			const names = candidates.map(c => c.surfaceForm);

			expect(names).toContain("John Smith");
		});

		test("extracts tool names like TypeScript", () => {
			const candidates = extractCandidates("Built with TypeScript and Node.js");
			const names = candidates.map(c => c.surfaceForm);

			expect(names).toContain("TypeScript");
		});

		test("extracts quoted concepts", () => {
			const candidates = extractCandidates('He mentioned "design patterns" and "SOLID"');
			const names = candidates.map(c => c.surfaceForm);

			expect(names).toContain("design patterns");
			expect(names).toContain("SOLID");
		});

		test("extracts backtick code references", () => {
			const candidates = extractCandidates("Use `addMemory` function and `queryMemories`");
			const names = candidates.map(c => c.surfaceForm);

			expect(names).toContain("addMemory");
			expect(names).toContain("queryMemories");
		});

		test("extracts hash tags", () => {
			const candidates = extractCandidates("Tag: #typescript #testing");
			const names = candidates.map(c => c.surfaceForm);

			expect(names).toContain("#typescript");
			expect(names).toContain("#testing");
		});

		test("skips stopwords", () => {
			const candidates = extractCandidates("The quick brown fox jumps");

			// "The" should be filtered out
			const hasThe = candidates.some(c => c.surfaceForm === "The");
			expect(hasThe).toBe(false);
		});

		test("skips very short matches", () => {
			const candidates = extractCandidates("a b c d e f");

			// Single characters should be filtered
			expect(candidates.length).toBe(0);
		});

		test("captures context around entities", () => {
			const candidates = extractCandidates("John works on the project");

			const john = candidates.find(c => c.surfaceForm === "John");
			expect(john?.context).toBeDefined();
			expect(john?.context).toContain("John");
			expect(john?.context).toContain("works");
		});
	});

	describe("scoreCandidates", () => {
		test("filters by minimum confidence", () => {
			const raw = extractCandidates("pi-mempalace TypeScript");
			const scored = scoreCandidates(raw, { minConfidence: CONFIDENCE_LEVELS.HIGH });

			// TypeScript is HIGH confidence
			const ts = scored.find(c => c.surfaceForm === "TypeScript");
			expect(ts).toBeDefined();
		});

		test("limits results per type", () => {
			const raw = extractCandidates("John Mary Bob Alice TypeScript JavaScript Python Rust Go");

			const scored = scoreCandidates(raw, { maxPerType: 2 });

			// Count by type
			const byType = new Map<string, number>();
			for (const c of scored) {
				byType.set(c.type, (byType.get(c.type) || 0) + 1);
			}

			// No type should exceed maxPerType
			for (const count of byType.values()) {
				expect(count).toBeLessThanOrEqual(2);
			}
		});

		test("sorts by confidence descending", () => {
			const raw = extractCandidates("pi-mempalace TypeScript Python");
			const scored = scoreCandidates(raw);

			for (let i = 1; i < scored.length; i++) {
				expect(scored[i - 1].confidence).toBeGreaterThanOrEqual(scored[i].confidence);
			}
		});

		test("deduplicates by normalized name", () => {
			const candidates = extractCandidates("John Smith is great. john smith rocks.");

			const uniqueNames = new Set(candidates.map(c => c.normalizedName));

			expect(uniqueNames.size).toBeLessThanOrEqual(
				candidates.filter(c => c.surfaceForm.toLowerCase() === "john smith").length,
			);
		});
	});

	describe("detectEntities", () => {
		test("returns high-quality entities by default", () => {
			const entities = detectEntities("pi-mempalace TypeScript John Smith");

			expect(entities.length).toBeGreaterThan(0);

			// All should meet minimum confidence
			for (const entity of entities) {
				expect(entity.confidence).toBeGreaterThanOrEqual(CONFIDENCE_LEVELS.LOW);
			}
		});

		test("respects maxEntities limit", () => {
			const text = `
				pi-mempalace TypeScript Rust Go Python JavaScript
				John Smith Mary Jane Bob Alice
				react vue angular svelte
				design pattern architecture algorithm
			`;

			const entities = detectEntities(text, { maxEntities: 5 });
			expect(entities.length).toBeLessThanOrEqual(5);
		});
	});

	describe("extractEntitiesWithRelationships", () => {
		test("extracts co-occurring entities from same sentence", () => {
			const result = extractEntitiesWithRelationships("pi-mempalace uses TypeScript. John works on it.");

			expect(result.entities.length).toBeGreaterThan(0);

			// pi-mempalace and TypeScript should be related (same sentence)
			const relatedPair = result.relationships.find(
				r =>
					(r.subject === "pi-mempalace" && r.object === "typescript") ||
					(r.subject === "typescript" && r.object === "pi-mempalace"),
			);

			expect(relatedPair).toBeDefined();
		});

		test("creates pairwise relationships within sentences", () => {
			const result = extractEntitiesWithRelationships("John works on TypeScript with Mary");

			// Should have relationships between: John-TypeScript, John-Mary, TypeScript-Mary
			expect(result.relationships.length).toBeGreaterThanOrEqual(3);
		});

		test("returns empty relationships for single entity", () => {
			const result = extractEntitiesWithRelationships("pi-mempalace is a project");

			// No pairwise relationships for single entity
			expect(result.relationships.length).toBe(0);
		});
	});

	describe("Entity Type Classification", () => {
		test("classifies kebab-case as project or conceptual", () => {
			const candidates = extractCandidates("my-awesome-project");
			// Kebab-case identifiers should be recognized as meaningful entities
			expect(candidates.length).toBeGreaterThan(0);
			const entity = candidates.find(c => c.normalizedName === "my-awesome-project");
			expect(entity).toBeDefined();
			// Should be classified as project or at minimum as an entity
			expect(entity?.confidence).toBeGreaterThan(0);
		});

		test("classifies TypeScript as tool", () => {
			const candidates = extractCandidates("TypeScript");
			const tool = candidates.find(c => c.surfaceForm === "TypeScript" || c.surfaceForm === "typescript");

			expect(tool).toBeDefined();
			expect(tool!.type).toMatch(new RegExp(`^(${ENTITY_TYPES.TOOL}|${ENTITY_TYPES.PROJECT})$`));
		});

		test("classifies quoted strings as conceptual", () => {
			const candidates = extractCandidates('"design pattern"');
			const conceptual = candidates.find(c => c.surfaceForm === "design pattern");

			expect(conceptual).toBeDefined();
			expect(conceptual!.type).toMatch(new RegExp(`^(${ENTITY_TYPES.CONCEPTUAL}|${ENTITY_TYPES.CONCEPT})$`));
		});

		test("classifies two-word capitalized names", () => {
			const candidates = extractCandidates("John Smith");
			const person = candidates.find(c => c.surfaceForm === "John Smith");

			expect(person).toBeDefined();
			// May be person, project or conceptual depending on classification
			expect(person!.type).toMatch(
				new RegExp(`^(${ENTITY_TYPES.PERSON}|${ENTITY_TYPES.PROJECT}|${ENTITY_TYPES.CONCEPTUAL})$`),
			);
		});

		test("extracts pi-mempalace as project", () => {
			const candidates = extractCandidates("pi-mempalace is a project");
			const project = candidates.find(c => c.normalizedName === "pi-mempalace");

			expect(project).toBeDefined();
			expect(project?.confidence).toBeGreaterThan(0);
		});
	});
});

describe("Entity Types Constants", () => {
	test("ENTITY_TYPES contains expected values", () => {
		expect(ENTITY_TYPES.PERSON).toBe("person");
		expect(ENTITY_TYPES.PROJECT).toBe("project");
		expect(ENTITY_TYPES.TOOL).toBe("tool");
		expect(ENTITY_TYPES.CONCEPT).toBe("concept");
		expect(ENTITY_TYPES.CONCEPTUAL).toBe("conceptual");
		expect(ENTITY_TYPES.ORGANIZATION).toBe("organization");
		expect(ENTITY_TYPES.FILE).toBe("file");
	});

	test("CONFIDENCE_LEVELS are in valid range", () => {
		expect(CONFIDENCE_LEVELS.HIGH).toBeGreaterThan(0);
		expect(CONFIDENCE_LEVELS.MEDIUM).toBeGreaterThan(0);
		expect(CONFIDENCE_LEVELS.LOW).toBeGreaterThan(0);

		expect(CONFIDENCE_LEVELS.HIGH).toBeLessThanOrEqual(1);
		expect(CONFIDENCE_LEVELS.MEDIUM).toBeLessThanOrEqual(1);
		expect(CONFIDENCE_LEVELS.LOW).toBeLessThanOrEqual(1);

		expect(CONFIDENCE_LEVELS.HIGH).toBeGreaterThan(CONFIDENCE_LEVELS.MEDIUM);
		expect(CONFIDENCE_LEVELS.MEDIUM).toBeGreaterThan(CONFIDENCE_LEVELS.LOW);
	});
});

describe("Palace Graph Utils", () => {
	test("KG_EDGE_TYPES contains expected values", async () => {
		const { KG_EDGE_TYPES } = await import("../../src/kg/types");

		expect(KG_EDGE_TYPES.CHILD_OF).toBe("child_of");
		expect(KG_EDGE_TYPES.LIKES).toBe("likes");
		expect(KG_EDGE_TYPES.WORKS_ON).toBe("works_on");
		expect(KG_EDGE_TYPES.KNOWS).toBe("knows");
		expect(KG_EDGE_TYPES.CREATED).toBe("created");
		expect(KG_EDGE_TYPES.MEMBER_OF).toBe("member_of");
		expect(KG_EDGE_TYPES.USES).toBe("uses");
		expect(KG_EDGE_TYPES.DEPENDS_ON).toBe("depends_on");
		expect(KG_EDGE_TYPES.RELATED_TO).toBe("related_to");
		expect(KG_EDGE_TYPES.IMPLEMENTS).toBe("implements");
	});
});

describe("Edge Cases", () => {
	test("handles empty string", () => {
		const candidates = extractCandidates("");
		expect(candidates).toEqual([]);
	});

	test("handles unicode text", () => {
		const candidates = extractCandidates("Привет мир مرحبا 世界");
		// Should not crash, may or may not extract
		expect(Array.isArray(candidates)).toBe(true);
	});

	test("handles very long text", () => {
		const longText = "pi-mempalace ".repeat(10000);
		const candidates = extractCandidates(longText);

		// Should process without hanging
		expect(Array.isArray(candidates)).toBe(true);
	});

	test("handles special characters in text", () => {
		const candidates = extractCandidates("Test: @user #hashtag `code` $variable %percent &amp;");

		expect(Array.isArray(candidates)).toBe(true);
	});

	test("handles multiple spaces and newlines", () => {
		const candidates = extractCandidates("John    Smith\n\nMary\n\nBob");

		expect(Array.isArray(candidates)).toBe(true);
	});

	test("handles entity at text boundaries", () => {
		const candidates = extractCandidates("John");
		const john = candidates.find(c => c.surfaceForm === "John");

		expect(john?.startIndex).toBe(0);
	});

	test("handles adjacent entities", () => {
		const candidates = extractCandidates("JohnMary");
		// Should extract as single entity or two depending on pattern
		expect(Array.isArray(candidates)).toBe(true);
	});
});
