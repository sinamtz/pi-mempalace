#!/usr/bin/env bun
/**
 * Agent runner — spawns a mempalace agent with a clean environment.
 * Usage: ./agent.mjs <phase> <id> <dataDir>
 *   phase: save | query
 *   id: agent number
 *   dataDir: absolute path to data directory
 */
const [phase, id, dataDir] = process.argv.slice(2);

// Unset any stale MEMPALACE env vars so the broker uses default config
delete process.env.MEMPALACE_PORT;
delete process.env.MEMPALACE_HOST;
delete process.env.MEMPALACE_USER;
delete process.env.MEMPALACE_PASS;
delete process.env.MEMPALACE_DATA_DIR;

const src = new URL("../src/index.ts", import.meta.url).pathname;

async function run() {
	const { initDb, closeDb, addMemories, queryMemories, embed } = await import(src);

	await initDb({ dataDir });

	if (phase === "save") {
		const e = await embed(`memory from agent ${id}`);
		// Use addMemories for a single batch insert (one transaction, no conflicts)
		await addMemories([{
			text: `Agent ${id} memory`,
			embedding: e,
			wing: "test",
			room: "integration",
			source: `agent-${id}`,
		}]);
		console.log(`SAVED:${id}`);
	} else {
		// Query with the agent's own text so embedding is similar
		const e = await embed(`memory from agent ${id}`);
		const r = await queryMemories(e, { wing: "test", limit: 200 });
		const sources = r.map((m) => m.memory?.source ?? "").filter(Boolean).sort();
		console.log(`QUERY:${id}:${JSON.stringify(sources)}`);
	}

	await closeDb();
}

run().catch((err) => {
	console.error(`ERROR:${id}:${err?.message ?? String(err)}`);
	process.exit(1);
});
