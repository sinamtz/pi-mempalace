/**
 * Layer 0: Identity — Persistent identity file.
 *
 * The identity layer is the foundational layer of the memory palace.
 * It contains immutable information about the agent's identity that
 * should always be loaded and available.
 *
 * The identity is stored in `identity.txt` in the data directory and
 * is loaded once on initialization, remaining cached for the session.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { getDataDir } from "../db";
import { logger } from "../logger";

/** Filename for the identity file. */
const IDENTITY_FILENAME = "identity.txt";

/** Cached identity content. */
let cachedIdentity: string | null = null;

/**
 * Get the path to the identity file.
 */
export function getIdentityPath(): string {
	return path.join(getDataDir(), IDENTITY_FILENAME);
}

/**
 * Read the identity file from disk.
 *
 * If the file doesn't exist, returns an empty string.
 * The result is cached after first read.
 *
 * @returns The identity content, or empty string if not set.
 */
export async function loadIdentity(): Promise<string> {
	if (cachedIdentity !== null) {
		return cachedIdentity;
	}

	const identityPath = getIdentityPath();

	try {
		const content = await fs.readFile(identityPath, "utf-8");
		cachedIdentity = content.trim();
		logger.debug("Identity loaded", { path: identityPath, length: cachedIdentity.length });
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") {
			cachedIdentity = "";
			logger.debug("Identity file not found", { path: identityPath });
		} else {
			logger.error("Failed to read identity file", { path: identityPath, error: String(err) });
			cachedIdentity = "";
		}
	}

	return cachedIdentity;
}

/**
 * Save identity content to the identity file.
 *
 * Overwrites any existing identity file.
 *
 * @param identity - The identity content to save.
 */
export async function saveIdentity(identity: string): Promise<void> {
	const identityPath = getIdentityPath();

	try {
		await fs.writeFile(identityPath, identity, "utf-8");
		cachedIdentity = identity;
		logger.info("Identity saved", { path: identityPath, length: identity.length });
	} catch (err) {
		logger.error("Failed to save identity file", { path: identityPath, error: String(err) });
		throw err;
	}
}

/**
 * Check if an identity has been set.
 *
 * @returns True if identity file exists and has content.
 */
export async function hasIdentity(): Promise<boolean> {
	const identity = await loadIdentity();
	return identity.length > 0;
}

/**
 * Clear the cached identity.
 *
 * Forces a re-read from disk on next access.
 */
export function clearIdentityCache(): void {
	cachedIdentity = null;
}

/**
 * Get the identity synchronously if cached.
 *
 * Returns null if identity hasn't been loaded yet.
 */
export function getIdentitySync(): string | null {
	return cachedIdentity;
}

/**
 * Default identity template.
 *
 * Used to guide users when creating their first identity.
 */
export const DEFAULT_IDENTITY_TEMPLATE = `You are an AI coding assistant, running within the Pi coding harness.

Your purpose is to assist with software development tasks, including:
- Writing, reviewing, and refactoring code
- Debugging issues and proposing solutions
- Explaining technical concepts and patterns
- Helping with project architecture decisions

Your capabilities are defined by the active Pi skills and the memory palace extension.

IMPORTANT: Update this identity when your role, capabilities, or context changes.
`;
