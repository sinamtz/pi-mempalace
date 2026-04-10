#!/usr/bin/env -S bun run
/**
 * Cross-process concurrency test for MemPalace singleton.
 *
 * Verifies that SurrealKV's file lock prevents multiple processes from
 * opening the same data directory simultaneously.
 *
 * Run: bun test test/singleton-crossprocess.ts
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";

const baseDir = path.join(os.tmpdir(), `mempalace-crossprocess-${Date.now()}`);
const dataDir = path.join(baseDir, "data");
const srcDir = path.resolve("src");

async function cleanup() {
	try {
		await fs.rm(baseDir, { recursive: true, force: true });
	} catch {}
}

async function run() {
	console.log("Cross-process concurrency test");
	console.log("Base dir:", baseDir);

	await fs.mkdir(dataDir, { recursive: true });

	// ── 1. Start holder process ──────────────────────────────────────────────
	const holderScript = `
import { connectDb } from "${srcDir}/broker.ts";
await connectDb({ dataDir: "${dataDir.replace(/\\/g, "\\\\")}" });
process.stdout.write("READY");
await new Promise(() => {}); // block forever
	`.trim();

	const holderPath = path.join(baseDir, "holder.mjs");
	await Bun.write(holderPath, holderScript);

	const holder = Bun.spawn(["bun", "run", holderPath], {
		stdout: "pipe",
		stderr: "inherit",
	});

	// Wait for READY
	const reader = holder.stdout!.getReader();
	const decoder = new TextDecoder();
	let holderOut = "";
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		holderOut += decoder.decode(value);
		if (holderOut.includes("READY")) break;
	}
	reader.releaseLock();
	const pid = parseInt(holderOut.split("READY")[1]!, 10);
	console.log(`Holder process started (PID ${pid})`);

	// ── 2. Verify lock file exists ─────────────────────────────────────────
	const dbPath = path.join(dataDir, "db");
	await Bun.sleep(100);
	const entries = await fs.readdir(dbPath);
	const lockFiles = entries.filter(e => e.toUpperCase().includes("LOCK"));
	console.log(`Lock files: ${lockFiles.join(", ") || "(none)"}`);
	if (lockFiles.length === 0) {
		console.log("⚠ No LOCK file found — cannot verify file locking behavior");
	}

	// ── 3. Try to connect from second process ───────────────────────────────
	const secondScript = `
import { connectDb } from "${srcDir}/broker.ts";
try {
  await connectDb({ dataDir: "${dataDir.replace(/\\/g, "\\\\")}" });
  console.log("OK");
} catch (e) {
  console.log("LOCKED:" + (e?.message ?? String(e)));
}
	`.trim();

	const secondPath = path.join(baseDir, "second.mjs");
	await Bun.write(secondPath, secondScript);

	const second = Bun.spawn(["bun", "run", secondPath], {
		stdout: "pipe",
		stderr: "inherit",
		timeout: 5000,
	});

	const secondOut = await new Response(second.stdout).text();
	const exitCode = second.exitCode;

	console.log(`Second process exit code: ${exitCode}`);
	console.log(`Second process output: ${secondOut.trim()}`);

	// ── 4. Cleanup ────────────────────────────────────────────────────────
	holder.kill();
	await cleanup();

	// ── 5. Assert ─────────────────────────────────────────────────────────
	let passed = false;

	if (exitCode !== 0) {
		console.log("✓ Second process was rejected (non-zero exit)");
		passed = true;
	} else if (secondOut.includes("LOCKED") || secondOut.includes("lock")) {
		console.log("✓ Second process caught lock error");
		passed = true;
	} else {
		console.log("✗ Second process succeeded — concurrent access was allowed!");
		passed = false;
	}

	if (passed) {
		console.log("\n✓ PASSED: Cross-process concurrency is protected by SurrealKV file lock");
		process.exit(0);
	} else {
		console.log("\n✗ FAILED: Concurrent access was not prevented");
		process.exit(1);
	}
}

run().catch(async e => {
	console.error("Test error:", e);
	await cleanup();
	process.exit(1);
});
