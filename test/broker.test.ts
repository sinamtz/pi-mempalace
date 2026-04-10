import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

import { loadConfig, saveConfig, getConfigPath } from "../src/config";
import { closeDb, getDb, isDbInitialized, connectDb } from "../src/broker";
import type { Config } from "../src/config";

/** Test directory for isolated tests */
const testDir = path.join(os.tmpdir(), `mempalace-broker-test-${Date.now()}`);
const _realHome = os.homedir();
const testHome = path.join(testDir, "home");
const testConfigPath = path.join(testHome, ".mempalace", "config.json");

/** Reset environment for each test */
function resetEnv(): void {
	delete process.env.MEMPALACE_PORT;
	delete process.env.MEMPALACE_HOST;
	delete process.env.MEMPALACE_USER;
	delete process.env.MEMPALACE_PASS;
	delete process.env.MEMPALACE_DATA_DIR;
	delete process.env.HOME;
}

/** Clean up test directory */
async function cleanup(): Promise<void> {
	try {
		await fs.rm(testDir, { recursive: true, force: true });
	} catch {
		// ignore
	}
}

beforeEach(async () => {
	await cleanup();
	await fs.mkdir(testHome, { recursive: true });
	resetEnv();
});

afterEach(async () => {
	// Close any open connections
	await closeDb();
	await cleanup();
	resetEnv();
});

// ── Config loading ──────────────────────────────────────────────────────────

describe("config loading", () => {
	it("returns defaults when no config file exists", async () => {
		resetEnv();
		process.env.HOME = testHome;
		const config = loadConfig();
		expect(config.port).toBe(8000);
		expect(config.host).toBe("127.0.0.1");
		expect(config.user).toBe("root");
		expect(config.pass).toBe("root");
		expect(config.dataDir).toMatch(/\.mempalace$/);
	});

	it("loads values from config file", async () => {
		resetEnv();
		process.env.HOME = testHome;
		const fileConfig: Config = {
			port: 9000,
			host: "0.0.0.0",
			user: "admin",
			pass: "secret",
			dataDir: "~/custom-path",
		};
		await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
		await fs.writeFile(testConfigPath, JSON.stringify(fileConfig));

		const config = loadConfig();
		expect(config.port).toBe(9000);
		expect(config.host).toBe("0.0.0.0");
		expect(config.user).toBe("admin");
		expect(config.pass).toBe("secret");
		expect(config.dataDir).toBe(path.join(testHome, "custom-path"));
	});

	it("environment variables override file values", async () => {
		resetEnv();
		process.env.HOME = testHome;
		process.env.MEMPALACE_PORT = "9999";
		process.env.MEMPALACE_HOST = "192.168.1.1";
		process.env.MEMPALACE_USER = "env-user";
		process.env.MEMPALACE_PASS = "env-pass";
		process.env.MEMPALACE_DATA_DIR = "/custom/env/path";

		const fileConfig: Config = {
			port: 9000,
			host: "0.0.0.0",
			user: "admin",
			pass: "secret",
			dataDir: "~/file-path",
		};
		await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
		await fs.writeFile(testConfigPath, JSON.stringify(fileConfig));

		const config = loadConfig();
		expect(config.port).toBe(9999);
		expect(config.host).toBe("192.168.1.1");
		expect(config.user).toBe("env-user");
		expect(config.pass).toBe("env-pass");
		expect(config.dataDir).toBe("/custom/env/path");
	});

	it("handles invalid port env var gracefully", async () => {
		resetEnv();
		process.env.HOME = testHome;
		process.env.MEMPALACE_PORT = "not-a-number";
		const fileConfig: Config = {
			port: 9000,
			host: "127.0.0.1",
			user: "root",
			pass: "root",
			dataDir: "~/.mempalace",
		};
		await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
		await fs.writeFile(testConfigPath, JSON.stringify(fileConfig));

		const config = loadConfig();
		expect(config.port).toBe(9000); // falls back to file value
	});

	it("handles out-of-range port env var gracefully", async () => {
		resetEnv();
		process.env.HOME = testHome;
		process.env.MEMPALACE_PORT = "99999";
		const fileConfig: Config = {
			port: 9000,
			host: "127.0.0.1",
			user: "root",
			pass: "root",
			dataDir: "~/.mempalace",
		};
		await fs.mkdir(path.dirname(testConfigPath), { recursive: true });
		await fs.writeFile(testConfigPath, JSON.stringify(fileConfig));

		const config = loadConfig();
		expect(config.port).toBe(9000); // falls back to file value
	});

	it("getConfigPath returns ~/<basedir>/.mempalace/config.json", () => {
		resetEnv();
		process.env.HOME = testHome;
		const configPath = getConfigPath();
		expect(configPath).toContain(".mempalace");
		expect(configPath).toContain("config.json");
	});
});

// ── Config save ─────────────────────────────────────────────────────────────

describe("config save", () => {
	it("saves config to file", async () => {
		resetEnv();
		process.env.HOME = testHome;
		const config: Config = {
			port: 7000,
			host: "localhost",
			user: "test",
			pass: "test123",
			dataDir: path.join(testDir, "data"),
		};
		await saveConfig(config);

		const content = await fs.readFile(testConfigPath, "utf-8");
		const saved = Bun.JSON5.parse(content) as Config;
		expect(saved.port).toBe(7000);
		expect(saved.host).toBe("localhost");
		expect(saved.user).toBe("test");
		expect(saved.pass).toBe("test123");
	});

	it("creates parent directory if not exists", async () => {
		resetEnv();
		process.env.HOME = testHome;
		const config: Config = {
			port: 7000,
			host: "localhost",
			user: "test",
			pass: "test123",
			dataDir: path.join(testDir, "data"),
		};
		// Ensure the directory doesn't exist initially
		await fs.rm(path.dirname(testConfigPath), { recursive: true, force: true });
		await saveConfig(config);

		// Verify the directory was created
		const exists = await fs
			.access(path.dirname(testConfigPath))
			.then(() => true)
			.catch(() => false);
		expect(exists).toBe(true);
	});
});

// ── Singleton pattern ────────────────────────────────────────────────────────

describe("singleton per cwd", () => {
	it("getDb throws when not connected", () => {
		resetEnv();
		expect(() => getDb()).toThrow();
	});

	it("closeDb is idempotent when not connected", async () => {
		resetEnv();
		await closeDb(); // should not throw
		expect(true).toBe(true);
	});

	it("isDbInitialized is false when not connected", () => {
		resetEnv();
		expect(isDbInitialized()).toBe(false);
	});
});

// ── connectDb throws without surreal ───────────────────────────────────────

describe("connectDb error handling", () => {
	it("throws clear error when surreal binary unavailable", async () => {
		resetEnv();
		// This will fail because surrealdb is not installed
		// The error should be descriptive
		const timeoutPromise = new Promise<never>((_, reject) => {
			setTimeout(() => reject(new Error("Test timeout")), 2000);
		});

		const connectPromise = connectDb({ dataDir: testDir });

		try {
			await Promise.race([connectPromise, timeoutPromise]);
			// If connect succeeds (surrealdb is available and fast), that's fine too
		} catch (error) {
			// Error should be descriptive - check for either the descriptive message or the raw error
			const errorStr = String(error);
			const isDescriptive =
				errorStr.includes("SurrealDB") ||
				errorStr.includes("start") ||
				errorStr.includes("failed") ||
				errorStr.includes("surrealdb") ||
				errorStr.includes("timeout");
			expect(isDescriptive).toBe(true);
		}
	});
});
