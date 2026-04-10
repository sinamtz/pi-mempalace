/**
 * Configuration system for MemPalace.
 *
 * Loads config from ~/.mempalace/config.json with environment variable overrides.
 * Environment variables take precedence over file values.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { isEnoent } from "./fs-error";
import { logger } from "./logger";
import { parseConfigText, stringifyConfigText, writeFile } from "./runtime";

/** Default configuration values. */
export const DEFAULT_CONFIG: Config = {
	port: 8000,
	host: "127.0.0.1",
	user: "root",
	pass: "root",
	dataDir: "~/.mempalace",
};

/** Configuration interface. */
export interface Config {
	/** Server port. Default: 8000 */
	port: number;
	/** Server host. Default: 127.0.0.1 */
	host: string;
	/** Authentication user. Default: root */
	user: string;
	/** Authentication password. Default: root */
	pass: string;
	/** Data directory path. Default: ~/.mempalace */
	dataDir: string;
	/** Optional SurrealDB CLI path or command name. */
	surrealBin?: string;
}

/** Internal serializable config type */
type SerializableConfig = {
	port: number;
	host: string;
	user: string;
	pass: string;
	dataDir: string;
	surrealBin?: string;
};

/**
 * Get the configuration file path.
 * Returns ~/.mempalace/config.json
 */
export function getConfigPath(): string {
	const home = process.env.HOME ?? os.homedir();
	return path.join(home, ".mempalace", "config.json");
}

/**
 * Load configuration from file with environment variable overrides.
 *
 * Environment variables (all prefixed with MEMPALACE_):
 * - MEMPALACE_PORT - server port (number)
 * - MEMPALACE_HOST - server host (string)
 * - MEMPALACE_USER - authentication user (string)
 * - MEMPALACE_PASS - authentication password (string)
 * - MEMPALACE_DATA_DIR - data directory path (string)
 * - MEMPALACE_SURREAL_BIN - surreal binary path or command name (string)
 *
 * @returns Merged configuration with env vars taking precedence
 */
export function loadConfig(): Config {
	// Start with defaults
	const config: Config = { ...DEFAULT_CONFIG };

	// Try to load from file
	const configPath = getConfigPath();
	let fileContent: string | undefined;

	try {
		fileContent = fs.readFileSync(configPath, "utf-8");
	} catch (err) {
		if (isEnoent(err)) {
			logger.debug("Config file not found, using defaults", { path: configPath });
		} else {
			logger.warn("Failed to read config file, using defaults", {
				path: configPath,
				error: String(err),
			});
		}
	}

	if (fileContent) {
		try {
			const fileConfig = parseConfigText(fileContent) as Partial<Config>;

			// Merge file config (only existing keys)
			if (fileConfig.port !== undefined) config.port = fileConfig.port;
			if (fileConfig.host !== undefined) config.host = fileConfig.host;
			if (fileConfig.user !== undefined) config.user = fileConfig.user;
			if (fileConfig.pass !== undefined) config.pass = fileConfig.pass;
			if (fileConfig.dataDir !== undefined) config.dataDir = fileConfig.dataDir;
			if (fileConfig.surrealBin !== undefined) config.surrealBin = fileConfig.surrealBin;
		} catch (parseErr) {
			logger.warn("Failed to parse config file, using defaults", {
				path: configPath,
				error: String(parseErr),
			});
		}
	}

	// Apply environment variable overrides
	if (process.env.MEMPALACE_PORT) {
		const port = parseInt(process.env.MEMPALACE_PORT!, 10);
		if (!Number.isNaN(port) && port > 0 && port <= 65535) {
			config.port = port;
		} else {
			logger.warn("Invalid MEMPALACE_PORT, ignoring", { value: process.env.MEMPALACE_PORT });
		}
	}

	if (process.env.MEMPALACE_HOST) {
		config.host = process.env.MEMPALACE_HOST!;
	}

	if (process.env.MEMPALACE_USER) {
		config.user = process.env.MEMPALACE_USER!;
	}

	if (process.env.MEMPALACE_PASS) {
		config.pass = process.env.MEMPALACE_PASS!;
	}

	if (process.env.MEMPALACE_DATA_DIR) {
		config.dataDir = process.env.MEMPALACE_DATA_DIR!;
	}

	if (process.env.MEMPALACE_SURREAL_BIN) {
		config.surrealBin = process.env.MEMPALACE_SURREAL_BIN!;
	}

	// Expand tilde in dataDir
	if (config.dataDir.startsWith("~/")) {
		const home = process.env.HOME ?? os.homedir();
		config.dataDir = path.join(home, config.dataDir.slice(2));
	}

	logger.debug("Config loaded", { ...config });
	return config;
}

/**
 * Save configuration to file.
 *
 * Creates the ~/.mempalace directory if it doesn't exist.
 *
 * @param config - Configuration to save
 */
export async function saveConfig(config: Config): Promise<void> {
	const configPath = getConfigPath();
	const configDir = path.dirname(configPath);

	// Ensure directory exists
	await fs.promises.mkdir(configDir, { recursive: true });

	// Write config as JSON5-compatible format
	const serializable: SerializableConfig = {
		port: config.port,
		host: config.host,
		user: config.user,
		pass: config.pass,
		dataDir: config.dataDir,
		...(config.surrealBin ? { surrealBin: config.surrealBin } : {}),
	};
	const content = stringifyConfigText(serializable);
	await writeFile(configPath, content);

	logger.debug("Config saved", { path: configPath });
}
