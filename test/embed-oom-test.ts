/**
 * OOM reproduction test for embedBatch.
 *
 * Simulates the mining pipeline: reads many files, chunks them,
 * and calls embedBatch with all chunks in one call.
 *
 * Before the MAX_CONCURRENT_INFERENCE fix, this would fire all
 * inference calls in parallel, accumulating GB of heap from
 * concurrent ONNX tensor allocations.
 *
 * With the fix (concurrency=4), memory stays bounded.
 *
 * Run: bun run test/embed-oom-test.ts
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const HEAP_START = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`Heap at start: ${HEAP_START.toFixed(1)} MB`);

// Load the embed module (triggers model download + load on first run)
console.log("Loading embed module...");
const { embedBatch } = await import("../src/embed");

const HEAP_AFTER_LOAD = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`Heap after model load: ${HEAP_AFTER_LOAD.toFixed(1)} MB`);

// Scan the src directory for files to chunk
const srcDir = path.join(__dirname, "..", "src");
const files = await findFiles(srcDir, [".ts", ".js", ".md"]);
console.log(`Found ${files.length} files`);

// Read and chunk all files
const allTexts: string[] = [];
for (const file of files.slice(0, 200)) {
	const content = await fs.readFile(file, "utf-8");
	// Split into roughly paragraph-sized chunks
	const paragraphs = content.split(/\n\n+/).filter(p => p.trim().length > 20);
	allTexts.push(...paragraphs.slice(0, 20)); // cap at 20 paragraphs per file
}

console.log(`Total chunks to embed: ${allTexts.length}`);

const HEAP_BEFORE_EMBED = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`Heap before embedBatch: ${HEAP_BEFORE_EMBED.toFixed(1)} MB`);

// This is the key test: with MAX_CONCURRENT_INFERENCE=4,
// all inference should be bounded, not parallel-unbounded.
console.log("Calling embedBatch (this is where OOM would happen without the fix)...");
const start = Date.now();

const embeddings = await embedBatch(allTexts);

const elapsed = (Date.now() - start) / 1000;
const HEAP_AFTER_EMBED = process.memoryUsage().heapUsed / 1024 / 1024;
console.log(`Heap after embedBatch: ${HEAP_AFTER_EMBED.toFixed(1)} MB`);
console.log(`Delta: +${(HEAP_AFTER_EMBED - HEAP_BEFORE_EMBED).toFixed(1)} MB`);
console.log(`Embeddings returned: ${embeddings.length} in ${elapsed.toFixed(1)}s`);

if (embeddings.length !== allTexts.length) {
	throw new Error(`expected ${allTexts.length} embeddings, got ${embeddings.length}`);
}

// Check all embeddings have correct dimension
let dimErrors = 0;
for (let i = 0; i < embeddings.length; i++) {
	if (embeddings[i].length !== 384) {
		dimErrors++;
		if (dimErrors <= 3) {
			console.error(`  Embedding ${i} has ${embeddings[i].length} dims (expected 384)`);
		}
	}
}
if (dimErrors > 0) {
	throw new Error(`${dimErrors}/${embeddings.length} embeddings have wrong dimension`);
}

console.log(`\n✓ embedBatch OOM-safe test passed`);
console.log(`  Chunks embedded: ${allTexts.length}`);
console.log(`  Memory delta: +${(HEAP_AFTER_EMBED - HEAP_AFTER_LOAD).toFixed(1)} MB total`);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function findFiles(dir: string, extensions: string[], maxFiles = 500): Promise<string[]> {
	const results: string[] = [];

	async function walk(d: string) {
		if (results.length >= maxFiles) return;
		try {
			const entries = await fs.readdir(d, { withFileTypes: true });
			for (const entry of entries) {
				if (results.length >= maxFiles) return;
				if (entry.name.startsWith(".")) continue;
				if (entry.isDirectory() && !["node_modules", ".git", "dist", "test"].includes(entry.name)) {
					await walk(path.join(d, entry.name));
				} else if (entry.isFile()) {
					const ext = path.extname(entry.name).toLowerCase();
					if (extensions.includes(ext)) {
						results.push(path.join(d, entry.name));
					}
				}
			}
		} catch {
			// skip
		}
	}

	await walk(dir);
	return results;
}
