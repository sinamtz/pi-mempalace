/**
 * Entity Detection for MemPalace Knowledge Graph.
 *
 * Two-pass entity extraction: first pass extracts candidates via pattern
 * matching, second pass scores and classifies them.
 *
 * Pattern categories:
 * - Names: Proper nouns, title-cased sequences
 * - Projects: kebab-case, snake_case identifiers, known project patterns
 * - Tools: Command names, library names, framework references
 * - Concepts: Technical terms, patterns in brackets, quoted terms
 */

import { logger } from "../logger";
import { type EntityCandidate, type EntityType, ENTITY_TYPES, CONFIDENCE_LEVELS } from "./types";

// Re-export for convenience
export { ENTITY_TYPES, CONFIDENCE_LEVELS };
export type { EntityCandidate, EntityType } from "./types";

/** Pattern definitions for entity extraction. */
interface ExtractionPattern {
	type: EntityType;
	patterns: RegExp[];
	confidence: number;
	/** Optional extractor function for complex patterns */
	extractor?: (match: RegExpExecArray, text: string) => string;
}

/** Capitalized name pattern (e.g., "John Smith", "Neural Network"). */
const CAPITALIZED_NAME = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\b/g;

/** Kebab-case identifier (e.g., "my-project", "pi-mempalace"). */
const KEBAB_CASE = /\b[a-z][a-z0-9]*(?:-[a-z0-9]+)+\b/g;

/** CamelCase identifier (e.g., "myProject", "entityDetector"). */
const CAMEL_CASE = /\b[a-z][a-zA-Z0-9]+[A-Z][a-zA-Z0-9]*\b/g;

/** Quoted strings (single or double). */
const QUOTED_STRING = /["']([^"']+)["']/g;

/** Hash-tagged terms (e.g., #hashtag). */
const HASH_TAG = /#([a-zA-Z][a-zA-Z0-9_]*)/g;

/** Code/formatted terms in backticks. */
const BACKTICK_CODE = /`([^`]+)`/g;

/** Common programming language names (with version indicators like Node.js). */
const LANGUAGES =
	/\b(TypeScript|JavaScript|Python|Rust|Go|Ruby|Java|C\+\+|C#|Swift|Kotlin|Perl|Lua|Shell|Bash|Zsh|PowerShell|SQL|HTML|CSS|Scala|R|Haskell|Elixir|Erlang|Clojure|F#|OCaml|Node\.js|NodeJS)\b/g;

/** Known framework/tool names - lowercase lookup for normalization. */
const KNOWN_TOOLS: Record<string, EntityType> = {
	react: ENTITY_TYPES.TOOL,
	vue: ENTITY_TYPES.TOOL,
	angular: ENTITY_TYPES.TOOL,
	next: ENTITY_TYPES.TOOL,
	"next.js": ENTITY_TYPES.TOOL,
	express: ENTITY_TYPES.TOOL,
	fastify: ENTITY_TYPES.TOOL,
	django: ENTITY_TYPES.TOOL,
	flask: ENTITY_TYPES.TOOL,
	rails: ENTITY_TYPES.TOOL,
	spring: ENTITY_TYPES.TOOL,
	huggingface: ENTITY_TYPES.TOOL,
	transformers: ENTITY_TYPES.TOOL,
	surrealdb: ENTITY_TYPES.TOOL,
	postgres: ENTITY_TYPES.TOOL,
	postgresql: ENTITY_TYPES.TOOL,
	mysql: ENTITY_TYPES.TOOL,
	mongodb: ENTITY_TYPES.TOOL,
	redis: ENTITY_TYPES.TOOL,
	docker: ENTITY_TYPES.TOOL,
	kubernetes: ENTITY_TYPES.TOOL,
	k8s: ENTITY_TYPES.TOOL,
	git: ENTITY_TYPES.TOOL,
	github: ENTITY_TYPES.TOOL,
	npm: ENTITY_TYPES.TOOL,
	yarn: ENTITY_TYPES.TOOL,
	bun: ENTITY_TYPES.TOOL,
	vite: ENTITY_TYPES.TOOL,
	webpack: ENTITY_TYPES.TOOL,
	esbuild: ENTITY_TYPES.TOOL,
	swc: ENTITY_TYPES.TOOL,
	neovim: ENTITY_TYPES.TOOL,
	vim: ENTITY_TYPES.TOOL,
	vscode: ENTITY_TYPES.TOOL,
	claude: ENTITY_TYPES.TOOL,
	openai: ENTITY_TYPES.TOOL,
	anthropic: ENTITY_TYPES.TOOL,
	typescript: ENTITY_TYPES.TOOL,
	javascript: ENTITY_TYPES.TOOL,
	python: ENTITY_TYPES.TOOL,
	rust: ENTITY_TYPES.TOOL,
	go: ENTITY_TYPES.TOOL,
};

/** Words that indicate conceptual entities. */
const CONCEPTUAL_INDICATORS = [
	"pattern",
	"architecture",
	"design",
	"algorithm",
	"protocol",
	"strategy",
	"approach",
	"methodology",
	"framework",
	"paradigm",
	"abstraction",
	"interface",
	"implementation",
	"system",
	"model",
];

/**
 * Normalize an entity name for storage.
 * - Trim whitespace
 * - Lowercase for comparison
 * - Collapse multiple spaces
 * - Remove common prefixes/suffixes
 */
export function normalizeEntityName(name: string): string {
	return name.trim().replace(/\s+/g, " ").replace(/[`'"]/g, "").toLowerCase();
}

/**
 * Get the context surrounding a match.
 */
function getContext(text: string, start: number, end: number, radius = 50): string {
	const before = text.slice(Math.max(0, start - radius), start);
	const after = text.slice(end, Math.min(text.length, end + radius));
	return `...${before}[${text.slice(start, end)}]${after}...`;
}

/**
 * Check if a candidate is likely a stopword or common word.
 * Note: We avoid filtering potential proper nouns (capitalized multi-word names).
 */
function isLikelyStopword(text: string): boolean {
	const normalized = normalizeEntityName(text);

	// Always filter common stopwords
	const stopwords = new Set([
		"the",
		"a",
		"an",
		"and",
		"or",
		"but",
		"in",
		"on",
		"at",
		"to",
		"for",
		"of",
		"with",
		"by",
		"from",
		"as",
		"is",
		"was",
		"are",
		"were",
		"been",
		"be",
		"have",
		"has",
		"had",
		"do",
		"does",
		"did",
		"will",
		"would",
		"could",
		"should",
		"may",
		"might",
		"must",
		"shall",
		"can",
		"need",
		"it",
		"its",
		"this",
		"that",
		"these",
		"those",
		"i",
		"you",
		"he",
		"she",
		"we",
		"they",
		"what",
		"which",
		"who",
		"when",
		"where",
		"why",
		"how",
		"all",
		"each",
		"every",
		"both",
		"few",
		"more",
		"most",
		"other",
		"some",
		"such",
		"only",
		"own",
		"same",
		"so",
		"than",
		"too",
		"very",
		"just",
		"also",
		"now",
		"here",
		"there",
		"then",
		"once",
		"if",
		"built",
		"with",
		"using",
		"tag",
	]);

	if (stopwords.has(normalized)) {
		return true;
	}

	// Filter single-character matches
	if (normalized.length < 2) {
		return true;
	}

	// For single capitalized words, also check if they could be names
	// We allow capitalized single words to pass through for now
	// The classification step will handle them
	return false;
}

/**
 * Classify a candidate entity based on its characteristics.
 */
function classifyCandidate(
	name: string,
	_matchedPattern: RegExp,
	context: string,
): { type: EntityType; confidence: number } {
	const normalized = normalizeEntityName(name);
	const lowerName = name.toLowerCase();

	// Check known tools first (highest priority)
	if (KNOWN_TOOLS[lowerName]) {
		return { type: KNOWN_TOOLS[lowerName], confidence: CONFIDENCE_LEVELS.HIGH };
	}

	// Check if it looks like a programming language
	if (LANGUAGES.test(name)) {
		LANGUAGES.lastIndex = 0;
		return { type: ENTITY_TYPES.TOOL, confidence: CONFIDENCE_LEVELS.HIGH };
	}

	// Kebab-case is typically project/package names
	if (KEBAB_CASE.test(name)) {
		KEBAB_CASE.lastIndex = 0;
		// Check if it's a known project
		if (normalized.includes("omp") || normalized.includes("pi-")) {
			return { type: ENTITY_TYPES.PROJECT, confidence: CONFIDENCE_LEVELS.HIGH };
		}
		return { type: ENTITY_TYPES.PROJECT, confidence: CONFIDENCE_LEVELS.MEDIUM };
	}

	// CamelCase identifiers are often code/classes
	if (CAMEL_CASE.test(name)) {
		CAMEL_CASE.lastIndex = 0;
		return { type: ENTITY_TYPES.CONCEPT, confidence: CONFIDENCE_LEVELS.LOW };
	}

	// Capitalized names are typically people or projects
	if (CAPITALIZED_NAME.test(name)) {
		CAPITALIZED_NAME.lastIndex = 0;
		// Check context for person indicators
		const contextLower = context.toLowerCase();
		const personIndicators = [
			"said",
			"mentioned",
			"talked",
			"spoke",
			"asked",
			"told",
			"writes",
			"author",
			"created",
			"developed",
			"designed",
		];

		for (const indicator of personIndicators) {
			if (contextLower.includes(indicator)) {
				return { type: ENTITY_TYPES.PERSON, confidence: CONFIDENCE_LEVELS.HIGH };
			}
		}

		// Two-word capitalized names are likely people
		if (name.split(/\s+/).length >= 2) {
			return { type: ENTITY_TYPES.PERSON, confidence: CONFIDENCE_LEVELS.MEDIUM };
		}

		// Single capitalized word could be a project or concept
		return { type: ENTITY_TYPES.PROJECT, confidence: CONFIDENCE_LEVELS.LOW };
	}

	// Hash tags are typically concepts or topics
	if (name.startsWith("#")) {
		return { type: ENTITY_TYPES.CONCEPT, confidence: CONFIDENCE_LEVELS.MEDIUM };
	}

	// Quoted strings often refer to concepts
	if (context.includes(`"${name}"`) || context.includes(`'${name}'`)) {
		return { type: ENTITY_TYPES.CONCEPTUAL, confidence: CONFIDENCE_LEVELS.MEDIUM };
	}

	// Check conceptual indicators in name
	for (const indicator of CONCEPTUAL_INDICATORS) {
		if (normalized.includes(indicator)) {
			return { type: ENTITY_TYPES.CONCEPT, confidence: CONFIDENCE_LEVELS.MEDIUM };
		}
	}

	// Default fallback
	return { type: ENTITY_TYPES.CONCEPTUAL, confidence: CONFIDENCE_LEVELS.LOW };
}

/**
 * Extract entity candidates from text using pattern matching.
 *
 * First pass: Find all pattern matches
 * Second pass: Score and classify each candidate
 *
 * @param text - Source text to analyze.
 * @returns Array of entity candidates with confidence scores.
 *
 * @example
 * ```typescript
 * const candidates = extractCandidates(
 *   "John Smith mentioned that the pi-mempalace project uses TypeScript"
 * );
 * // Returns candidates for "John Smith", "pi-mempalace", "TypeScript"
 * ```
 */
export function extractCandidates(text: string): EntityCandidate[] {
	const candidates: EntityCandidate[] = [];
	const seen = new Map<string, EntityCandidate>();

	// First pass: Extract known tools/languages directly
	// This runs before other patterns to ensure high-quality matches
	LANGUAGES.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = LANGUAGES.exec(text)) !== null) {
		const surfaceForm = match[0];
		const startIndex = match.index;
		const endIndex = startIndex + surfaceForm.length;

		if (isLikelyStopword(surfaceForm)) continue;
		if (surfaceForm.length < 2 || surfaceForm.length > 100) continue;

		const normalized = normalizeEntityName(surfaceForm);

		if (seen.has(normalized)) continue;

		const context = getContext(text, startIndex, endIndex);

		const candidate: EntityCandidate = {
			surfaceForm,
			normalizedName: normalized,
			type: ENTITY_TYPES.TOOL,
			confidence: CONFIDENCE_LEVELS.HIGH,
			context,
			startIndex,
			endIndex,
		};

		candidates.push(candidate);
		seen.set(normalized, candidate);
	}

	// Define remaining extraction patterns
	const patterns: ExtractionPattern[] = [
		// High confidence: kebab-case projects
		{
			type: ENTITY_TYPES.PROJECT,
			patterns: [KEBAB_CASE],
			confidence: 0.8,
		},
		// Medium confidence: quoted concepts
		{
			type: ENTITY_TYPES.CONCEPTUAL,
			patterns: [QUOTED_STRING],
			confidence: 0.7,
		},
		// Medium confidence: code identifiers
		{
			type: ENTITY_TYPES.CONCEPT,
			patterns: [BACKTICK_CODE],
			confidence: 0.6,
		},
		// Medium confidence: hash tags
		{
			type: ENTITY_TYPES.CONCEPT,
			patterns: [HASH_TAG],
			confidence: 0.6,
			extractor: m => `#${m[1]}`, // Include the # prefix
		},
		// Variable: capitalized names
		{
			type: ENTITY_TYPES.PERSON,
			patterns: [CAPITALIZED_NAME],
			confidence: 0.5,
		},
	];

	// Extract remaining patterns
	for (const { type, patterns: regexes, confidence, extractor } of patterns) {
		for (const regex of regexes) {
			regex.lastIndex = 0;
			let match: RegExpExecArray | null;

			while ((match = regex.exec(text)) !== null) {
				// Extract the matched text
				const surfaceForm = extractor ? extractor(match, text) : (match[1] ?? match[0]);
				const startIndex = match.index;
				const endIndex = startIndex + surfaceForm.length;

				// Skip stopwords and very short matches
				if (isLikelyStopword(surfaceForm)) {
					continue;
				}

				// Skip if too short or too long
				if (surfaceForm.length < 2 || surfaceForm.length > 100) {
					continue;
				}

				const normalized = normalizeEntityName(surfaceForm);

				// Skip if we've already seen this entity
				if (seen.has(normalized)) {
					// Update confidence if higher
					const existing = seen.get(normalized)!;
					if (confidence > existing.confidence) {
						existing.confidence = confidence;
						existing.type = type;
					}
					continue;
				}

				const context = getContext(text, startIndex, endIndex);
				const classification = classifyCandidate(surfaceForm, regex, context);

				const candidate: EntityCandidate = {
					surfaceForm,
					normalizedName: normalized,
					type: classification.type,
					confidence: Math.max(confidence, classification.confidence),
					context,
					startIndex,
					endIndex,
				};

				candidates.push(candidate);
				seen.set(normalized, candidate);
			}
		}
	}

	logger.debug("Entity candidates extracted", {
		total: candidates.length,
		byType: candidates.reduce(
			(acc, c) => {
				acc[c.type] = (acc[c.type] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>,
		),
	});

	return candidates;
}

/**
 * Score and filter entity candidates.
 *
 * Removes low-confidence candidates and duplicates,
 * normalizes confidence based on context quality.
 *
 * @param candidates - Raw candidates from extractCandidates.
 * @param options - Scoring options.
 * @returns Filtered and scored candidates.
 */
export function scoreCandidates(
	candidates: EntityCandidate[],
	options: {
		minConfidence?: number;
		maxPerType?: number;
	} = {},
): EntityCandidate[] {
	const { minConfidence = CONFIDENCE_LEVELS.LOW, maxPerType = 20 } = options;

	// Filter by minimum confidence
	const filtered = candidates.filter(c => c.confidence >= minConfidence);

	// Group by normalized name and keep highest confidence per unique entity
	const byName = new Map<string, EntityCandidate>();
	for (const candidate of filtered) {
		const existing = byName.get(candidate.normalizedName);
		if (!existing || candidate.confidence > existing.confidence) {
			byName.set(candidate.normalizedName, candidate);
		}
	}

	// Limit per type
	const byType = new Map<EntityType, EntityCandidate[]>();
	for (const candidate of byName.values()) {
		const typeList = byType.get(candidate.type) || [];
		typeList.push(candidate);
		byType.set(candidate.type, typeList);
	}

	const result: EntityCandidate[] = [];
	for (const [, typeCandidates] of byType) {
		// Sort by confidence descending
		typeCandidates.sort((a, b) => b.confidence - a.confidence);
		// Take top N per type
		result.push(...typeCandidates.slice(0, maxPerType));
	}

	// Sort final result by confidence descending
	result.sort((a, b) => b.confidence - a.confidence);

	logger.debug("Entity candidates scored", {
		input: candidates.length,
		output: result.length,
		byType: result.reduce(
			(acc, c) => {
				acc[c.type] = (acc[c.type] || 0) + 1;
				return acc;
			},
			{} as Record<string, number>,
		),
	});

	return result;
}

/**
 * Main entry point: extract and score entities from text.
 *
 * @param text - Source text to analyze.
 * @param options - Extraction and scoring options.
 * @returns Final list of high-quality entity candidates.
 */
export function detectEntities(
	text: string,
	options: {
		minConfidence?: number;
		maxEntities?: number;
	} = {},
): EntityCandidate[] {
	const candidates = extractCandidates(text);
	return scoreCandidates(candidates, {
		minConfidence: options.minConfidence,
		maxPerType: options.maxEntities ? Math.ceil(options.maxEntities / 4) : undefined,
	});
}

/**
 * Extract entities with their co-occurrence relationships.
 *
 * When multiple entities appear in the same context (sentence, paragraph),
 * they are considered related.
 *
 * @param text - Source text to analyze.
 * @returns Detected entities and inferred relationships.
 */
export function extractEntitiesWithRelationships(text: string): {
	entities: EntityCandidate[];
	relationships: Array<{ subject: string; object: string; context: string }>;
} {
	// Split into sentences for co-occurrence detection
	const sentences = text
		.split(/[.!?]+/)
		.map(s => s.trim())
		.filter(Boolean);

	const entities = detectEntities(text);
	const relationships: Array<{ subject: string; object: string; context: string }> = [];

	// Find entities that co-occur in the same sentence
	for (const sentence of sentences) {
		// Get entities that appear in this sentence
		const sentenceEntities = entities.filter(e => {
			// Check if surfaceForm or normalizedName appears in sentence
			return sentence.includes(e.surfaceForm) || sentence.includes(e.normalizedName);
		});

		// Create pairwise relationships
		for (let i = 0; i < sentenceEntities.length; i++) {
			for (let j = i + 1; j < sentenceEntities.length; j++) {
				relationships.push({
					subject: sentenceEntities[i].normalizedName,
					object: sentenceEntities[j].normalizedName,
					context: sentence,
				});
			}
		}
	}

	return { entities, relationships };
}
