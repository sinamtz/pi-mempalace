/**
 * SurrealDB connection and schema initialization for MemPalace.
 *
 * Delegates to broker.ts for connection management (auto-server pattern).
 * Re-exports array utilities from array-utils.ts.
 */

import * as broker from "./broker";

// ── Connection management (delegated to broker) ─────────────────────────────

export async function initDb(options?: { dataDir?: string }) {
	return broker.connectDb(options);
}

export function getDb() {
	return broker.getDb();
}

export function getDataDir() {
	return broker.getDataDir();
}

export async function closeDb() {
	return broker.closeDb();
}

export function isDbInitialized() {
	return broker.isDbInitialized();
}

// ── Array utilities (from array-utils) ────────────────────────────────────

export { toSurrealArray, fromSurrealArray, toSurrealVector } from "./array-utils";
