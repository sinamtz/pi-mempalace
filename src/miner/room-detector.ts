/**
 * Pattern-based room classification for MemPalace.
 *
 * Routes content to specific rooms based on file paths, content patterns,
 * and configurable taxonomy rules.
 */

import { logger } from "../logger";

/** Room taxonomy configuration */
export interface RoomConfig {
	/** Room identifier */
	room: string;
	/** Display name for the room */
	displayName: string;
	/** File path patterns that belong to this room */
	pathPatterns?: string[];
	/** Content patterns that indicate this room */
	contentPatterns?: RegExp[];
	/** Priority (higher = checked first) */
	priority?: number;
}

/** Default room taxonomy */
export const DEFAULT_ROOMS: RoomConfig[] = [
	{
		room: "documentation",
		displayName: "Documentation",
		pathPatterns: ["**/README*", "**/CHANGELOG*", "**/CONTRIBUTING*", "**/docs/**", "**/*.md"],
		contentPatterns: [/#+\s+\w/, /^```\w+/m],
		priority: 10,
	},
	{
		room: "tests",
		displayName: "Tests",
		pathPatterns: ["**/*.test.ts", "**/*.spec.ts", "**/__tests__/**", "**/test/**"],
		contentPatterns: [/describe\s*\(|it\s*\(|expect\s*\(/, /@test\b/i],
		priority: 10,
	},
	{
		room: "source",
		displayName: "Source Code",
		pathPatterns: ["**/*.ts", "**/*.js", "**/*.tsx", "**/*.jsx"],
		contentPatterns: [/\bfunction\s+\w+|\bclass\s+\w+|\bconst\s+\w+\s*=/],
		priority: 5,
	},
	{
		room: "config",
		displayName: "Configuration",
		pathPatterns: ["**/package.json", "**/tsconfig*.json", "**/.env*", "**/config/**"],
		contentPatterns: [/^\s*["']\w+["']\s*:/m, /\b(extends|compilerOptions)\s*:/],
		priority: 15,
	},
	{
		room: "data",
		displayName: "Data Files",
		pathPatterns: ["**/*.json", "**/*.yaml", "**/*.yml", "**/*.csv"],
		priority: 10,
	},
	{
		room: "styles",
		displayName: "Styles",
		pathPatterns: ["**/*.css", "**/*.scss", "**/*.less"],
		priority: 10,
	},
	{
		room: "api",
		displayName: "API",
		pathPatterns: ["**/api/**", "**/routes/**", "**/endpoints/**"],
		contentPatterns: [/\b(GET|POST|PUT|DELETE|PATCH)\s+\//i, /\bendpoint\b/i],
		priority: 12,
	},
	{
		room: "database",
		displayName: "Database",
		pathPatterns: ["**/db/**", "**/models/**", "**/schemas/**"],
		contentPatterns: [/\b(SELECT|INSERT|UPDATE|DELETE|CREATE TABLE)\b/i, /\b(DROP|ALTER)\b/i],
		priority: 12,
	},
	{
		room: "infrastructure",
		displayName: "Infrastructure",
		pathPatterns: ["**/docker*", "**/.github/**", "**/ci/**", "**/k8s/**"],
		contentPatterns: [/\bFROM\s+\w+/i, /\bdocker\b/i, /\bkubernetes\b/i],
		priority: 12,
	},
	{
		room: "scripts",
		displayName: "Scripts",
		pathPatterns: ["**/*.sh", "**/scripts/**"],
		priority: 10,
	},
	{
		room: "general",
		displayName: "General",
		priority: 0,
	},
];

/** Room detection result */
export interface RoomDetectionResult {
	/** Detected room identifier */
	room: string;
	/** Confidence score (0-1) */
	confidence: number;
	/** Which rule matched */
	matchedRule?: string;
	/** Whether this was a path match or content match */
	matchType?: "path" | "content" | "both";
}

/**
 * Detect the room for a given file path and optional content.
 *
 * Checks path patterns first, then content patterns. Returns the
 * room with highest confidence based on matched rules.
 *
 * @param filePath - The file path to classify.
 * @param content - Optional file content for pattern matching.
 * @param rooms - Custom room taxonomy (defaults to DEFAULT_ROOMS).
 * @returns Detection result with room and confidence.
 */
export function detectRoom(
	filePath: string,
	content?: string,
	rooms: RoomConfig[] = DEFAULT_ROOMS,
): RoomDetectionResult {
	// Sort rooms by priority (higher first)
	const sortedRooms = [...rooms].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

	let bestMatch: RoomDetectionResult = {
		room: "general",
		confidence: 0,
	};

	for (const config of sortedRooms) {
		let pathScore = 0;
		let contentScore = 0;
		let pathMatched = false;
		let contentMatched = false;

		// Check path patterns
		if (config.pathPatterns && config.pathPatterns.length > 0) {
			for (const pattern of config.pathPatterns) {
				if (matchGlobPattern(filePath, pattern)) {
					pathScore = 1.0;
					pathMatched = true;
					break;
				}
			}
		}

		// Check content patterns
		if (content && config.contentPatterns && config.contentPatterns.length > 0) {
			for (const pattern of config.contentPatterns) {
				if (pattern.test(content)) {
					contentScore = 1.0;
					contentMatched = true;
					break;
				}
			}
		}

		// Only consider if there's a match
		if (pathScore > 0 || contentScore > 0) {
			// Path matches are weighted higher (1.0) than content matches (0.7)
			const confidence = pathScore * 0.7 + contentScore * 0.3;
			const basePriority = (config.priority ?? 0) / 20; // Normalize to 0-1

			// Combine confidence with priority
			const combinedConfidence = confidence * 0.7 + basePriority * 0.3;

			if (combinedConfidence > bestMatch.confidence) {
				bestMatch = {
					room: config.room,
					confidence: Math.min(combinedConfidence, 1.0),
					matchedRule: config.displayName,
					matchType: pathMatched && contentMatched ? "both" : pathMatched ? "path" : "content",
				};
			}
		}
	}

	logger.debug("Room detected", {
		filePath,
		room: bestMatch.room,
		confidence: bestMatch.confidence,
		matchType: bestMatch.matchType,
	});

	return bestMatch;
}

/**
 * Simple glob pattern matching for room detection.
 *
 * Supports:
 * - `**` for directory matching
 * - `*` for single-segment wildcards
 * - `?` for single character wildcards
 * - Character classes `[abc]`
 *
 * @param path - The path to test.
 * @param pattern - Glob pattern to match against.
 * @returns True if the path matches the pattern.
 */
function matchGlobPattern(path: string, pattern: string): boolean {
	// Normalize path separators
	const normalizedPath = path.replace(/\\/g, "/");
	const normalizedPattern = pattern.replace(/\\/g, "/");

	// Convert glob pattern to regex
	const regexPattern = globToRegex(normalizedPattern);

	try {
		const regex = new RegExp(regexPattern, "i");
		return regex.test(normalizedPath);
	} catch {
		logger.warn("Invalid glob pattern", { pattern });
		return false;
	}
}

/**
 * Convert a glob pattern to a regex pattern string.
 */
function globToRegex(glob: string): string {
	let regex = "";
	let i = 0;

	while (i < glob.length) {
		const char = glob[i];

		if (char === "*") {
			if (glob[i + 1] === "*") {
				// `**` matches any path
				if (glob[i + 2] === "/") {
					// `**/` matches directories
					regex += "(?:.*/)?";
					i += 3;
					continue;
				} else if (i + 2 === glob.length) {
					// `**` at end matches everything
					regex += ".*";
					i += 2;
					continue;
				}
			}
			// Single `*` matches non-slash characters
			regex += "[^/]*";
			i++;
		} else if (char === "?") {
			// `?` matches single character
			regex += "[^/]";
			i++;
		} else if (char === "[") {
			// Character class
			regex += "[";
			i++;
			if (glob[i] === "!") {
				regex += "^";
				i++;
			}
			while (i < glob.length && glob[i] !== "]") {
				if (glob[i] === "\\") {
					regex += `\\${glob[i + 1]}`;
					i += 2;
				} else {
					regex += glob[i];
					i++;
				}
			}
			regex += "]";
			i++;
		} else if (
			char === "." ||
			char === "+" ||
			char === "^" ||
			char === "$" ||
			char === "|" ||
			char === "(" ||
			char === ")"
		) {
			// Escape regex special characters
			regex += `\\${char}`;
			i++;
		} else {
			// Regular character
			regex += char;
			i++;
		}
	}

	return `^${regex}$`;
}

/**
 * Detect room from conversation content.
 *
 * Uses content-based detection with domain-specific patterns
 * for conversations (Q&A, discussions, etc.).
 *
 * @param content - The conversation text.
 * @param rooms - Custom room taxonomy.
 * @returns Detection result.
 */
export function detectConversationRoom(content: string, _rooms: RoomConfig[] = DEFAULT_ROOMS): RoomDetectionResult {
	// Conversation-specific room patterns
	const conversationRoomPatterns: Array<{
		room: string;
		patterns: RegExp[];
	}> = [
		{
			room: "debugging",
			patterns: [
				/\b(error|exception|failed|bug|issue|problem|fix|patch)\b/i,
				/\b(stack trace|stacktrace|traceback)\b/i,
				/\b(debug|inspect|console\.log)\b/i,
			],
		},
		{
			room: "implementation",
			patterns: [
				/\b(implement|create|build|make|add)\s+(?:(?:a|an|the|my)\s+)?\w+\s+(function|class|method|module|component)\b/i,
				/\b(write|code|develop|codebase)\b/i,
				/\b(extends|implements|interface|type)\b/i,
			],
		},
		{
			room: "planning",
			patterns: [
				/\b(plan|design|architecture|roadmap|todo|task)\b/i,
				/\b(sprint|milestone|phase)\b/i,
				/\b(estimate|prioritize|stories)\b/i,
			],
		},
		{
			room: "review",
			patterns: [
				/\b(review|pull request|pr|code review|approve|reject)\b/i,
				/\b(suggest|recommend|consider|instead)\b/i,
				/\b(nit|minor|major|critical)\b/i,
			],
		},
		{
			room: "testing",
			patterns: [
				/\b(test|spec|unit|integration|e2e)\b/i,
				/\b(mock|stub|spy|fake)\b/i,
				/\b(assert|expect|should|it\s*\()\b/i,
			],
		},
		{
			room: "documentation",
			patterns: [/\b(doc|document|readme|comment|explain)\b/i, /\b(javadoc|jsdoc|typedoc|swagger|openapi)\b/i],
		},
		{
			room: "refactoring",
			patterns: [
				/\b(refactor|restructure|cleanup|simplify|extract)\b/i,
				/\b(technical debt|legacy|monolith)\b/i,
				/\b(modular|decouple|abstract)\b/i,
			],
		},
	];

	// Find best matching room from conversation patterns
	let bestMatch: RoomDetectionResult = {
		room: "general",
		confidence: 0,
	};

	for (const { room, patterns } of conversationRoomPatterns) {
		let matchCount = 0;
		for (const pattern of patterns) {
			if (pattern.test(content)) {
				matchCount++;
			}
		}

		if (matchCount > 0) {
			// More pattern matches = higher confidence
			const confidence = Math.min((matchCount / patterns.length) * 0.8 + 0.2, 1.0);

			if (confidence > bestMatch.confidence) {
				bestMatch = {
					room,
					confidence,
					matchType: "content",
				};
			}
		}
	}

	logger.debug("Conversation room detected", {
		contentPreview: content.slice(0, 100),
		room: bestMatch.room,
		confidence: bestMatch.confidence,
	});

	return bestMatch;
}

/**
 * Create a custom room taxonomy from directory structure.
 *
 * Analyzes a directory tree and creates room mappings based
 * on the folder structure found.
 *
 * @param directories - Array of directory paths.
 * @returns RoomConfig array based on directory structure.
 */
export function createTaxonomyFromDirectories(directories: string[]): RoomConfig[] {
	const rooms: RoomConfig[] = [];
	const seenRooms = new Set<string>();

	for (const dir of directories) {
		// Extract meaningful directory names
		const parts = dir.split("/").filter(Boolean);
		const lastPart = parts[parts.length - 1]?.toLowerCase() ?? "";

		if (!lastPart || seenRooms.has(lastPart)) continue;

		seenRooms.add(lastPart);

		rooms.push({
			room: lastPart,
			displayName: formatDisplayName(lastPart),
			pathPatterns: [`**/${lastPart}/**`, `**/${lastPart}/`],
			priority: 10,
		});
	}

	// Always include general fallback
	rooms.push({
		room: "general",
		displayName: "General",
		priority: 0,
	});

	return rooms;
}

/**
 * Format a directory name into a display name.
 */
function formatDisplayName(name: string): string {
	return name.replace(/[-_]+/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}
