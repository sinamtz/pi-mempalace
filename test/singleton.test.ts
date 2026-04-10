import { describe, it, expect } from "vitest"

// These tests verify the module-level singleton contract.
// They do NOT connect to SurrealDB — they test the cache/proxy behavior.
//
// The actual cross-process sharing is tested in:
//   bun run test:singleton-crossprocess

// ── Module cache identity ────────────────────────────────────────────────────
// Node/Bun caches module instances. Multiple dynamic imports of the same module
// return the same cached object reference. This is the foundation of the singleton:
// one module instance = one set of module-level variables = one connection pool.

describe("module cache singleton", () => {
	it("two dynamic imports return the same module instance", async () => {
		const mod1 = await import("../src/broker");
		const mod2 = await import("../src/broker");
		expect(mod1).toBe(mod2); // Same object reference = module cache hit
	});

	it("the broker module exposes the expected API", async () => {
		const mod = await import("../src/broker");
		expect(typeof mod.connectDb).toBe("function");
		expect(typeof mod.closeDb).toBe("function");
		expect(typeof mod.getDb).toBe("function");
		expect(typeof mod.getDataDir).toBe("function");
		expect(typeof mod.isDbInitialized).toBe("function");
	});

	it("connectDb is the same function across imports", async () => {
		const mod1 = await import("../src/broker");
		const mod2 = await import("../src/broker");
		expect(mod1.connectDb).toBe(mod2.connectDb);
		expect(mod1.closeDb).toBe(mod2.closeDb);
	});

	it("the config module exposes the expected API", async () => {
		const mod = await import("../src/config");
		expect(typeof mod.loadConfig).toBe("function");
		expect(typeof mod.saveConfig).toBe("function");
		expect(typeof mod.getConfigPath).toBe("function");
		expect(typeof mod.DEFAULT_CONFIG).toBe("object");
	});

	it("config has correct defaults", async () => {
		const { DEFAULT_CONFIG } = await import("../src/config");
		expect(DEFAULT_CONFIG.port).toBe(8000);
		expect(DEFAULT_CONFIG.host).toBe("127.0.0.1");
		expect(DEFAULT_CONFIG.user).toBe("root");
		expect(DEFAULT_CONFIG.pass).toBe("root");
	});

	it("getConfigPath returns a path ending in config.json", async () => {
		const { getConfigPath } = await import("../src/config");
		const p = getConfigPath();
		expect(p.endsWith("config.json")).toBe(true);
	});
});
