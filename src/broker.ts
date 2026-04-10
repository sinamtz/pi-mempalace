/**
 * Auto-Server Broker for MemPalace.
 *
 * Singleton pattern:
 * - First agent in a dataDir spawns `surreal start` on a port derived from dataDir
 * - Subsequent agents in the same dataDir connect via WebSocket
 * - Per-dataDir singleton: same dataDir in same process = same connection
 * - Port isolation: different data dirs get different ports (hash-based)
 */

import "./websocket-polyfill";
import { Surreal } from "surrealdb";

import * as fs from "node:fs/promises";
import * as path from "node:path";
import { loadConfig, type Config } from "./config";
import { logger } from "./logger";
import { type BackgroundProcess, sleep, spawnBackground } from "./runtime";
import { resolveSurrealBinary } from "./surreal-binary";
import { toSurrealArray, fromSurrealArray, toSurrealVector } from "./array-utils";

/** Per-dataDir singleton: one connection per data directory. */
const instances = new Map<string, { db: Surreal; config: Config }>();

/** Hash dataDir to a port in range [7000, 7999]. */
function dataDirToPort(dataDir: string): number {
	let h = 0;
	for (let i = 0; i < dataDir.length; i++) {
		h = ((h << 5) - h + dataDir.charCodeAt(i)) | 0;
	}
	return 7000 + (Math.abs(h) % 1000);
}

// ── Server management ──────────────────────────────────────────────────────

/** Surreal process handle (owned by this process). */
let surrealProcess: BackgroundProcess | null = null;

/** Check if a server is already running at the given host:port. */
async function isServerRunning(host: string, port: number): Promise<boolean> {
	try {
		const controller = new AbortController();
		const timeoutId = setTimeout(() => controller.abort(), 1000);
		const res = await fetch(`http://${host}:${port}/status`, {
			signal: controller.signal,
		});
		clearTimeout(timeoutId);
		return res.ok;
	} catch {
		return false;
	}
}

/**
 * Spawn the `surreal start` server process.
 * Resolves a configured, installed, or managed SurrealDB binary at runtime.
 */
async function spawnServer(config: Config): Promise<void> {
	const dbPath = path.join(config.dataDir, "db");
	await fs.mkdir(dbPath, { recursive: true });

	// Fast pre-check: if server already running, bail out immediately
	if (await isServerRunning(config.host, config.port)) {
		throw new Error("Server already running");
	}

	const surrealBinary = await resolveSurrealBinary(config);

	logger.debug("Spawning SurrealDB server", {
		bin: surrealBinary,
		dataDir: dbPath,
		host: config.host,
		port: config.port,
	});

	surrealProcess = spawnBackground(surrealBinary, [
		"start",
		"--bind",
		`${config.host}:${config.port}`,
		"--user",
		config.user,
		"--pass",
		config.pass,
		"--log",
		"error",
		`surrealkv:${dbPath}`,
	]);

	logger.debug("SurrealDB server spawned", { pid: surrealProcess.pid });

	// Wait for server to be ready
	const maxWait = 15_000;
	const startTime = Date.now();
	while (Date.now() - startTime < maxWait) {
		if (await isServerRunning(config.host, config.port)) {
			logger.info("SurrealDB server ready", { host: config.host, port: config.port });
			return;
		}
		await sleep(100);
	}

	throw new Error("SurrealDB server failed to start within 15s");
}

/**
 * Connect to an existing server via WebSocket.
 */
async function connectToServer(config: Config): Promise<Surreal> {
	const url = `ws://${config.host}:${config.port}`;
	logger.debug("Connecting to SurrealDB server", { url });

	const db = new Surreal();
	await db.connect(url);
	await db.use({ namespace: "mempalace", database: "main" });
	await db.signin({ username: config.user, password: config.pass });

	return db;
}

// ── Process exit handlers ─────────────────────────────────────────────────

/**
 * Hard timeout (ms) for closing a single DB connection.
 * SurrealDB's WebSocket client can hang in a reconnect loop when the server dies.
 * Using a timeout ensures process exit is not indefinitely blocked.
 */
const DB_CLOSE_TIMEOUT = 2000;

/** Register SIGTERM/SIGINT/exit handlers to ensure clean worker shutdown. */
function registerExitHandlers(): void {
	// Prevent double registration
	if ((globalThis as typeof globalThis & { __mempalaceExitHandlers?: boolean }).__mempalaceExitHandlers) {
		return;
	}
	(globalThis as typeof globalThis & { __mempalaceExitHandlers: boolean }).__mempalaceExitHandlers = true;

	/**
	 * SIGTERM/SIGINT: vitest sends SIGTERM when a worker times out.
	 * Best-effort cleanup — don't await db.close() since SurrealDB WASM + websocket
	 * keepalive can block exit indefinitely. Let the OS clean up sockets.
	 */
	const terminate = (): void => {
		for (const inst of instances.values()) {
			inst.db.close().catch(() => {});
		}
		if (surrealProcess) {
			surrealProcess.kill();
			surrealProcess = null;
		}
		instances.clear();
	};

	process.on("SIGTERM", terminate);
	process.on("SIGINT", terminate);

	// Normal exit: best-effort cleanup.
	process.on("exit", () => {
		for (const inst of instances.values()) {
			inst.db.close().catch(() => {});
		}
		if (surrealProcess) {
			surrealProcess.kill();
		}
	});
}

// ── Public API ────────────────────────────────────────────────────────────

/**
 * Connect to the shared SurrealDB instance.
 *
 * Auto-Server behavior:
 * - Each dataDir gets its own port (derived from dataDir hash -> [7000,7999])
 * - First agent in a directory spawns surreal binary on its port
 * - Subsequent agents connect via WebSocket
 * - Idempotent per dataDir
 */
export async function connectDb(options?: { dataDir?: string }): Promise<Surreal> {
	registerExitHandlers();

	const baseConfig = loadConfig();
	const requestedDataDir = options?.dataDir ? path.resolve(options.dataDir) : baseConfig.dataDir;

	// Per-dataDir singleton key
	const key = requestedDataDir;
	const existing = instances.get(key);
	if (existing) {
		return existing.db;
	}

	// Derive a port from dataDir so different directories get different servers
	const port = dataDirToPort(requestedDataDir);
	const config: Config = { ...baseConfig, dataDir: requestedDataDir, port };

	logger.debug("Initializing MemPalace", {
		dataDir: config.dataDir,
		host: config.host,
		port: config.port,
	});

	await fs.mkdir(config.dataDir, { recursive: true });

	// Try to spawn first. If server is already running (another process beat us),
	// the pre-check in spawnServer throws fast -> fall back to connecting.
	try {
		await spawnServer(config);
	} catch (err) {
		logger.debug("Server already running, connecting", { error: String(err) });
	}

	// connectToServer can also fail (server died, wrong port, etc.) — handle gracefully
	let db: Surreal;
	try {
		db = await connectToServer(config);
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		logger.error("Failed to connect to SurrealDB server", { error: msg, url: `ws://${config.host}:${config.port}` });
		throw new Error(`Failed to connect to SurrealDB server: ${msg}`);
	}

	// Idempotent schema init
	await db.query(
		`
		DEFINE TABLE IF NOT EXISTS memory SCHEMAFULL;
		DEFINE FIELD IF NOT EXISTS text ON memory TYPE string;
		DEFINE FIELD IF NOT EXISTS embedding ON memory TYPE array<float>;
		DEFINE FIELD IF NOT EXISTS wing ON memory TYPE string;
		DEFINE FIELD IF NOT EXISTS room ON memory TYPE string;
		DEFINE FIELD IF NOT EXISTS source ON memory TYPE string;
		DEFINE FIELD IF NOT EXISTS timestamp ON memory TYPE option<datetime> DEFAULT NONE;
		DEFINE INDEX IF NOT EXISTS mt_idx ON memory FIELDS embedding HNSW
			DIMENSION 384 DIST COSINE EFC 150 M 16;

		DEFINE TABLE IF NOT EXISTS person SCHEMAFULL;
		DEFINE FIELD IF NOT EXISTS name ON person TYPE string;
		DEFINE FIELD IF NOT EXISTS type ON person TYPE string;
		DEFINE FIELD IF NOT EXISTS properties ON person TYPE object;
	`.trim(),
	);

	logger.info("MemPalace connected", {
		dataDir: config.dataDir,
		host: config.host,
		port: config.port,
	});

	instances.set(key, { db, config });
	return db;
}

export function getDb(): Surreal {
	const inst = instances.values().next().value;
	if (!inst) throw new Error("MemPalace not initialized. Call connectDb() first.");
	return inst.db;
}

export function getDataDir(): string {
	const inst = instances.values().next().value;
	return inst?.config.dataDir ?? loadConfig().dataDir;
}

export function getConfig(): Config {
	const inst = instances.values().next().value;
	return inst?.config ?? loadConfig();
}

export function isDbInitialized(): boolean {
	return instances.size > 0;
}

/** Close the DB connection and stop the spawned SurrealDB process. */
export async function closeDb(): Promise<void> {
	await closeAllDb();
}

/**
 * Close all DB connections and stop all spawned SurrealDB processes.
 * Uses hard timeouts on db.close() to avoid hanging when the SurrealDB WebSocket
 * client gets stuck in a reconnect loop during shutdown.
 */
export async function closeAllDb(): Promise<void> {
	if (instances.size === 0) return;

	logger.debug("Closing all MemPalace connections", { count: instances.size });

	// Close all DB connections with hard timeout.
	const closePromises: Promise<void>[] = [];
	for (const inst of instances.values()) {
		closePromises.push(
			(async () => {
				try {
					await Promise.race([
						inst.db.close(),
						sleep(DB_CLOSE_TIMEOUT).then(() => {
							logger.debug("DB close timed out, abandoning connection", { dataDir: inst.config.dataDir });
						}),
					]);
				} catch (err) {
					logger.debug("Error closing DB", { error: String(err) });
				}
			})(),
		);
	}

	await Promise.allSettled(closePromises);
	instances.clear();

	if (surrealProcess) {
		logger.debug("Stopping SurrealDB server", { pid: surrealProcess.pid });
		surrealProcess.kill();
		surrealProcess = null;
	}
}

export { toSurrealArray, fromSurrealArray, toSurrealVector };
