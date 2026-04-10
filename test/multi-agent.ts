#!/usr/bin/env bun
/**
 * Multi-agent integration test for pi-mempalace Auto-Server.
 *
 * Tests two scenarios:
 * 1. Single-dir: multiple agents share one data dir (one server, cross-process sharing)
 * 2. Multi-dir: agents in different dirs get isolated servers (no interference)
 *
 * Usage:
 *   bun run test/multi-agent.ts              # single-dir: 5 save + 5 query
 *   bun run test/multi-agent.ts --count=3   # single-dir: 3 save + 3 query
 *   bun run test/multi-agent.ts --multi-dir # multi-dir: one agent per dir
 */

import { spawn } from "bun";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const args = new Set(process.argv.slice(2));
const doMultiDir = args.has("--multi-dir");
const countArg = [...args].find(a => a.startsWith("--count="));
const count = countArg ? parseInt(countArg.split("=")[1]!, 10) : 5;

const agentScript = path.resolve(path.join(import.meta.dir, "agent.mjs"));

/** Spawn an agent with a hard timeout so we never hang. */
async function spawnAgent(phase: "save" | "query", id: number, dataDir: string, timeoutMs = 30_000) {
	const proc = spawn(["bun", "run", agentScript, phase, String(id), dataDir], {
		stdout: "pipe",
		stderr: "pipe",
		stdin: "ignore",
	});
	let timedOut = false;
	const timer = setTimeout(() => {
		timedOut = true;
		proc.kill();
	}, timeoutMs);
	try {
		const [out, err] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text()]);
		await proc.exited;
		return { id, out: out.trim(), err: err.trim(), timedOut };
	} finally {
		clearTimeout(timer);
	}
}

async function testSingleDir() {
	// All agents share one data dir -> one server, cross-process memory sharing
	const dataDir = path.join(os.tmpdir(), `mempalace-single-${Date.now()}`);
	await fs.mkdir(dataDir, { recursive: true });
	console.log(`[single-dir] Data dir: ${dataDir}`);

	// Save: sequential to avoid SurrealKV transaction conflicts
	console.log(`\n[single-dir] Saving ${count} agents sequentially...`);
	let saved = 0;
	for (let i = 1; i <= count; i++) {
		const r = await spawnAgent("save", i, dataDir);
		if (r.out.startsWith("SAVED:")) {
			saved++;
			process.stdout.write(".");
		} else {
			console.error(`\n  agent-${r.id}: ${r.out.split("ERROR:")[1] ?? r.out}`);
		}
	}
	console.log(`\n[single-dir] Saved: ${saved}/${count}`);
	if (saved < count) {
		console.log("[single-dir] FAIL");
		return false;
	}

	// Query: all agents query -- should find all sources
	await Bun.sleep(200);
	console.log(`\n[single-dir] Querying from ${count} agents sequentially...`);
	const allSources = new Set<string>();
	let queried = 0;
	for (let i = 1; i <= count; i++) {
		const r = await spawnAgent("query", i, dataDir);
		if (r.out.startsWith("QUERY:")) {
			queried++;
			const json = r.out.replace(/^QUERY:\d+:/, "");
			try {
				const sources: string[] = JSON.parse(json);
				for (const s of sources) {
					allSources.add(s);
				}
			} catch {
				/* ignore */
			}
		} else if (r.out.startsWith("ERROR:") || r.err) {
			console.log(`  agent-${r.id}: ${r.out.split("ERROR:")[1] ?? r.err}`);
		}
	}
	console.log(`[single-dir] Queried: ${queried}/${count}, Unique sources: ${allSources.size}/${count}`);
	if (allSources.size < count) {
		const missing = Array.from({ length: count }, (_, i) => `agent-${i + 1}`).filter(a => !allSources.has(a));
		console.log(`[single-dir] FAIL -- missing: ${missing.join(", ")}`);
		return false;
	}
	console.log("[single-dir] PASS");
	return true;
}

async function testMultiDir() {
	// Each agent gets its own data dir -> isolated servers, no sharing
	console.log(`\n[multi-dir] Testing ${count} isolated directories...`);
	const dirs: string[] = [];
	for (let i = 0; i < count; i++) {
		dirs.push(path.join(os.tmpdir(), `mempalace-iso-${Date.now()}-${i}`));
	}

	// Save: parallel spawns (each gets its own server)
	await Promise.all(dirs.map(d => fs.mkdir(d, { recursive: true })));
	console.log(`[multi-dir] Saving ${count} agents in parallel...`);
	const saveResults = await Promise.all(dirs.map((d, i) => spawnAgent("save", i + 1, d, 45_000)));
	const saved = saveResults.filter(r => r.out.startsWith("SAVED:")).length;
	console.log(`[multi-dir] Saved: ${saved}/${count}`);
	if (saved < count) {
		for (const r of saveResults) {
			if (!r.out.startsWith("SAVED:")) {
				console.log(`  agent-${r.id}: ${r.out.split("ERROR:")[1] ?? r.out}`);
			}
		}
		console.log("[multi-dir] FAIL");
		return false;
	}

	// Query: each dir should only see its own source (sequential to avoid port reuse issues)
	await Bun.sleep(200);
	console.log(`[multi-dir] Querying ${count} dirs sequentially...`);
	let passed = 0;
	for (let i = 0; i < count; i++) {
		const r = await spawnAgent("query", i + 1, dirs[i], 30_000);
		if (!r.out.startsWith("QUERY:")) continue;
		const json = r.out.replace(/^QUERY:\d+:/, "");
		try {
			const sources: string[] = JSON.parse(json);
			if (sources.length === 1) {
				passed++;
				console.log(`  agent-${r.id}: ${sources[0]} ok`);
			} else {
				console.log(`  agent-${r.id}: ${JSON.stringify(sources)} FAIL (expected 1 source)`);
			}
		} catch {
			/* ignore */
		}
	}
	console.log(`[multi-dir] Isolated: ${passed}/${count}`);
	if (passed < count) {
		console.log("[multi-dir] FAIL");
		return false;
	}
	console.log("[multi-dir] PASS");
	return true;
}

async function main() {
	let ok = true;
	if (doMultiDir) {
		ok = await testMultiDir();
	} else {
		ok = await testSingleDir();
	}
	if (!ok) process.exit(1);
	console.log("\nAll tests passed");
}

main().catch(e => {
	console.error("FATAL:", e);
	process.exit(1);
});
