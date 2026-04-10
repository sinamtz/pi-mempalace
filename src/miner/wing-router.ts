/**
 * Wing assignment logic for MemPalace mining pipeline.
 *
 * Wings are high-level spatial divisions of the memory palace.
 * This module handles wing assignment based on project context,
 * directory structure, and configuration.
 */

import * as path from "node:path";
import { logger } from "../logger";

/** Wing configuration */
export interface WingConfig {
	/** Unique wing identifier */
	wing: string;
	/** Display name for the wing */
	displayName: string;
	/** Root directories that belong to this wing */
	roots?: string[];
	/** File path patterns that belong to this wing */
	pathPatterns?: string[];
	/** Environment variables that indicate this wing (undefined value = match any value) */
	envVars?: Record<string, string | undefined>;
	/** Priority for disambiguation (higher = checked first) */
	priority?: number;
}

/** Wing detection result */
export interface WingAssignment {
	/** Assigned wing identifier */
	wing: string;
	/** Confidence score (0-1) */
	confidence: number;
	/** Which rule matched */
	reason?: string;
}

/** Default wing taxonomy */
export const DEFAULT_WINGS: WingConfig[] = [
	{
		wing: "work",
		displayName: "Work",
		pathPatterns: ["**/work/**", "**/projects/**", "**/company/**"],
		envVars: { WORK_DIR: undefined, COMPANY_NAME: "company" },
		priority: 10,
	},
	{
		wing: "personal",
		displayName: "Personal",
		pathPatterns: ["**/personal/**", "**/home/**"],
		priority: 5,
	},
	{
		wing: "open-source",
		displayName: "Open Source",
		pathPatterns: ["**/github/**", "**/git/**"],
		priority: 8,
	},
	{
		wing: "learning",
		displayName: "Learning",
		pathPatterns: ["**/learn/**", "**/study/**", "**/courses/**"],
		priority: 8,
	},
	{
		wing: "archived",
		displayName: "Archived",
		pathPatterns: ["**/archive/**", "**/old/**", "**/.archive/**"],
		priority: 3,
	},
];

/**
 * Determine the wing for a given path and context.
 *
 * Checks various signals to determine the appropriate wing:
 * 1. Path patterns (directory matching)
 * 2. Environment variables
 * 3. Git repository context
 * 4. Project configuration files
 *
 * @param filePath - The file or directory path to classify.
 * @param context - Additional context (git remote, env vars, etc.).
 * @param wings - Custom wing taxonomy.
 * @returns Wing assignment with confidence.
 */
export function assignWing(
	filePath: string,
	context: WingAssignmentContext = {},
	wings: WingConfig[] = DEFAULT_WINGS,
): WingAssignment {
	// Sort wings by priority
	const sortedWings = [...wings].sort((a, b) => (b.priority ?? 0) - (a.priority ?? 0));

	// Resolve to absolute path if needed
	const absolutePath = path.resolve(filePath);

	let bestMatch: WingAssignment = {
		wing: "default",
		confidence: 0,
	};

	for (const config of sortedWings) {
		let matchScore = 0;
		let reason: string | undefined;

		// Check environment variables
		if (config.envVars) {
			for (const [key, expectedValue] of Object.entries(config.envVars)) {
				const actualValue = process.env[key];
				if (actualValue) {
					if (expectedValue === undefined || actualValue.includes(expectedValue)) {
						matchScore = Math.max(matchScore, 0.8);
						reason = `env:${key}`;
					}
				}
			}
		}

		// Check context git remote
		if (context.gitRemote) {
			const remote = context.gitRemote.toLowerCase();
			if (remote.includes("github") || remote.includes("gitlab")) {
				if (config.wing === "open-source") {
					matchScore = Math.max(matchScore, 0.7);
					reason = reason ?? "git:open-source";
				}
			}
			if (remote.includes("bitbucket") || remote.includes("internal")) {
				matchScore = Math.max(matchScore, 0.6);
				reason = reason ?? "git:internal";
			}
		}

		// Check path patterns
		if (config.pathPatterns) {
			for (const pattern of config.pathPatterns) {
				if (matchPathPattern(absolutePath, pattern)) {
					matchScore = Math.max(matchScore, 0.9);
					reason = reason ?? `path:${pattern}`;
					break;
				}
			}
		}

		// Check root directories
		if (config.roots) {
			for (const root of config.roots) {
				if (absolutePath.startsWith(root) || absolutePath.includes(root)) {
					matchScore = Math.max(matchScore, 0.85);
					reason = reason ?? `root:${root}`;
					break;
				}
			}
		}

		// Apply priority bonus
		const priorityBonus = ((config.priority ?? 0) / 20) * 0.1;
		matchScore = Math.min(matchScore + priorityBonus, 1.0);

		if (matchScore > bestMatch.confidence) {
			bestMatch = {
				wing: config.wing,
				confidence: matchScore,
				reason,
			};
		}
	}

	// If no match, try to infer from path structure
	if (bestMatch.confidence === 0) {
		bestMatch = inferWingFromPath(absolutePath);
	}

	logger.debug("Wing assigned", {
		filePath,
		wing: bestMatch.wing,
		confidence: bestMatch.confidence,
		reason: bestMatch.reason,
	});

	return bestMatch;
}

/** Context for wing assignment */
export interface WingAssignmentContext {
	/** Git remote URL */
	gitRemote?: string;
	/** Current working directory */
	cwd?: string;
	/** Project name (from package.json, etc.) */
	projectName?: string;
}

/**
 * Infer wing from path structure when no explicit match.
 */
function inferWingFromPath(absolutePath: string): WingAssignment {
	// Common patterns for wing inference
	const patterns: Array<{
		wing: string;
		pattern: RegExp;
		reason: string;
	}> = [
		// OS home directories
		{ wing: "home", pattern: /^\/home\/[^/]+/, reason: "home directory" },
		{ wing: "work", pattern: /^\/Users\/[^/]+\/Documents\/Work/, reason: "work documents" },
		{ wing: "personal", pattern: /^\/Users\/[^/]+\/Documents\/Personal/, reason: "personal documents" },

		// Development directories
		{ wing: "dev", pattern: /\/dev\//, reason: "dev directory" },
		{ wing: "code", pattern: /\/code[s]?\//, reason: "code directory" },
		{ wing: "src", pattern: /\/src\//, reason: "source directory" },

		// IDE/project directories
		{ wing: "project", pattern: /\/projects?\//i, reason: "projects directory" },
		{ wing: "workspace", pattern: /\/workspaces?\//i, reason: "workspace directory" },

		// Git directories
		{ wing: "git", pattern: /\.git\//, reason: "git repository" },

		// Node.js
		{ wing: "node_modules", pattern: /\/node_modules\//, reason: "dependency" },
	];

	for (const { wing, pattern, reason } of patterns) {
		if (pattern.test(absolutePath)) {
			return {
				wing,
				confidence: 0.3,
				reason,
			};
		}
	}

	// Default fallback
	return {
		wing: "default",
		confidence: 0.1,
		reason: "no match",
	};
}

/**
 * Match a path against a glob pattern.
 */
function matchPathPattern(filePath: string, pattern: string): boolean {
	// Normalize separators
	const normalizedPath = filePath.replace(/\\/g, "/");
	const normalizedPattern = pattern.replace(/\\/g, "/");

	// Convert glob to regex
	const regex = globToRegex(normalizedPattern);

	try {
		return new RegExp(regex, "i").test(normalizedPath);
	} catch {
		return false;
	}
}

/**
 * Convert glob pattern to regex string.
 */
function globToRegex(glob: string): string {
	let regex = "";
	let i = 0;

	while (i < glob.length) {
		const char = glob[i];

		if (char === "*") {
			if (glob[i + 1] === "*") {
				if (glob[i + 2] === "/") {
					regex += "(?:.*/)?";
					i += 3;
					continue;
				} else if (i + 2 === glob.length) {
					regex += ".*";
					i += 2;
					continue;
				}
			}
			regex += "[^/]*";
			i++;
		} else if (char === "?") {
			regex += "[^/]";
			i++;
		} else if (char === "[") {
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
		} else if (".+^$|(){}".includes(char)) {
			regex += `\\${char}`;
			i++;
		} else {
			regex += char;
			i++;
		}
	}

	return `^${regex}$`;
}

/**
 * Assign wing from project context.
 *
 * Uses project metadata (package.json, project structure) to determine wing.
 *
 * @param projectDir - The project directory.
 * @param wings - Custom wing taxonomy.
 * @returns Wing assignment.
 */
export function assignWingFromProject(projectDir: string, wings: WingConfig[] = DEFAULT_WINGS): WingAssignment {
	const context: WingAssignmentContext = {
		cwd: projectDir,
	};

	// Try to detect project type from directory name
	const dirName = path.basename(projectDir).toLowerCase();

	// Known project type patterns
	const projectPatterns: Record<string, string> = {
		frontend: "frontend",
		back: "backend",
		backend: "backend",
		api: "backend",
		shared: "shared",
		common: "shared",
		utils: "shared",
		cli: "tooling",
		tools: "tooling",
		infra: "infrastructure",
		docs: "documentation",
	};

	for (const [keyword, wing] of Object.entries(projectPatterns)) {
		if (dirName.includes(keyword)) {
			return {
				wing,
				confidence: 0.7,
				reason: `project:${keyword}`,
			};
		}
	}

	// Fall back to path-based assignment
	return assignWing(projectDir, context, wings);
}

/**
 * Create wing taxonomy from environment.
 *
 * Looks for environment variable patterns like:
 * - WORK_DIR
 * - PERSONAL_DIR
 * - PROJECTS_DIR
 *
 * @returns WingConfig array based on environment.
 */
export function createWingsFromEnvironment(): WingConfig[] {
	const wings: WingConfig[] = [];

	// Check for work directory
	const workDir = process.env.WORK_DIR;
	if (workDir) {
		wings.push({
			wing: "work",
			displayName: "Work",
			roots: [workDir],
			priority: 15,
		});
	}

	// Check for personal directory
	const personalDir = process.env.PERSONAL_DIR;
	if (personalDir) {
		wings.push({
			wing: "personal",
			displayName: "Personal",
			roots: [personalDir],
			priority: 10,
		});
	}

	// Check for projects directory
	const projectsDir = process.env.PROJECTS_DIR;
	if (projectsDir) {
		wings.push({
			wing: "projects",
			displayName: "Projects",
			roots: [projectsDir],
			priority: 12,
		});
	}

	return wings;
}
