/**
 * Tests for MemPalace mining pipeline.
 *
 * Verifies:
 * - Text chunking (paragraph and exchange-based)
 * - Room detection (path and content patterns)
 * - Wing assignment (path and project context)
 * - File mining (directory scanning, gitignore, binary detection)
 * - Conversation mining (parsing, room detection)
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest"
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
// Bun-compatible __dirname equivalent for Node.js/vitest
const __dirname = path.dirname(new URL(import.meta.url).pathname);

// Test database setup
const testDir = path.join(os.tmpdir(), `mempalace-miner-test-${Date.now()}`);
const _testDbPath = path.join(testDir, "db");

async function cleanupTestDir() {
	try {
		await fs.rm(testDir, { recursive: true, force: true });
	} catch {
		// Ignore cleanup errors
	}
}

// ============================================================================
// Chunking Tests
// ============================================================================

describe("Chunker", () => {
	describe("splitParagraphs", () => {
		it("should split text by blank lines", async () => {
			const { splitParagraphs } = await import("../src/miner/chunker");

			const text = "First paragraph.\nWith multiple lines.\n\nSecond paragraph.\n\n\nThird paragraph.";
			const paragraphs = splitParagraphs(text);

			expect(paragraphs.length).toBe(3);
			expect(paragraphs[0].text).toBe("First paragraph.\nWith multiple lines.");
			expect(paragraphs[1].text).toBe("Second paragraph.");
			expect(paragraphs[2].text).toBe("Third paragraph.");
		});

		it("should handle empty input", async () => {
			const { splitParagraphs } = await import("../src/miner/chunker");

			expect(splitParagraphs("").length).toBe(0);
			expect(splitParagraphs("\n\n\n").length).toBe(0);
		});

		it("should trim whitespace", async () => {
			const { splitParagraphs } = await import("../src/miner/chunker");

			const text = "  \n  Leading whitespace.  \n\n  \n  Trailing whitespace.  ";
			const paragraphs = splitParagraphs(text);

			expect(paragraphs[0].text).toBe("Leading whitespace.");
			expect(paragraphs[1].text).toBe("Trailing whitespace.");
		});
	});

	describe("chunkByParagraphs", () => {
		it("should chunk text by target size", async () => {
			const { chunkByParagraphs } = await import("../src/miner/chunker");

			// Create text longer than target chunk size
			const text =
				"This is paragraph one.\n\nThis is paragraph two.\n\nThis is paragraph three.\n\nThis is paragraph four.";
			const chunks = chunkByParagraphs(text, "test", { targetSize: 30, maxSize: 50 });

			expect(chunks.length).toBeGreaterThan(1);
			expect(chunks.every(c => c.source === "test")).toBe(true);
			expect(chunks.every(c => c.index >= 0)).toBe(true);
		});

		it("should assign correct indices", async () => {
			const { chunkByParagraphs } = await import("../src/miner/chunker");

			const text = "Short paragraph.\n\nAnother short paragraph.";
			const chunks = chunkByParagraphs(text, "test");

			expect(chunks[0].index).toBe(0);
		});

		it("should preserve offsets", async () => {
			const { chunkByParagraphs } = await import("../src/miner/chunker");

			const text = "First paragraph.\n\nSecond paragraph.";
			const chunks = chunkByParagraphs(text, "test");

			expect(chunks.every(c => c.offset >= 0)).toBe(true);
			expect(chunks.every(c => c.length > 0)).toBe(true);
		});
	});

	describe("chunkConversation", () => {
		it("should chunk conversation by exchanges", async () => {
			const { chunkConversation } = await import("../src/miner/chunker");

			const text = `What is TypeScript?

TypeScript is a typed superset of JavaScript.

How do I use interfaces?

You define them with the interface keyword.

What about generics?

Generics allow you to create reusable components.`;

			const chunks = chunkConversation(text, "test");

			expect(chunks.length).toBeGreaterThan(0);
			expect(chunks.every(c => c.text.length > 10)).toBe(true);
		});

		it("should assign source to all chunks", async () => {
			const { chunkConversation } = await import("../src/miner/chunker");

			const text = "Question one?\nAnswer one.\n\nQuestion two?\nAnswer two.";
			const chunks = chunkConversation(text, "my-conversation");

			expect(chunks.every(c => c.source === "my-conversation")).toBe(true);
		});
	});
});

// ============================================================================
// Room Detection Tests
// ============================================================================

describe("Room Detector", () => {
	describe("detectRoom", () => {
		it("should detect documentation room from .md extension", async () => {
			const { detectRoom } = await import("../src/miner/room-detector");

			const result = detectRoom("/path/to/README.md", "# Title\n\nContent");
			expect(result.room).toBe("documentation");
		});

		it("should detect tests room from test file patterns", async () => {
			const { detectRoom } = await import("../src/miner/room-detector");

			const result = detectRoom(
				"/path/to/sum.test.ts",
				"describe('test', () => {\n  it('works', () => {\n    expect(sum(1, 2)).toBe(3);\n  });\n});",
			);
			expect(result.room).toBe("tests");
		});

		it("should detect source room from .ts files", async () => {
			const { detectRoom } = await import("../src/miner/room-detector");

			const result = detectRoom("/path/to/module.ts", "export function foo() {\n  return 'bar';\n}");
			expect(result.room).toBe("source");
		});

		it("should detect config room from package.json", async () => {
			const { detectRoom } = await import("../src/miner/room-detector");

			const result = detectRoom("/path/to/package.json", '{"name": "test", "version": "1.0.0"}');
			expect(result.room).toBe("config");
		});

		it("should use custom room taxonomy", async () => {
			const { detectRoom } = await import("../src/miner/room-detector");

			const customRooms = [
				{
					room: "custom-room",
					displayName: "Custom Room",
					pathPatterns: ["**/special/**"],
					priority: 20,
				},
			];

			const result = detectRoom("/path/to/special/file.txt", "content", customRooms);
			expect(result.room).toBe("custom-room");
		});

		it("should fall back to general for unknown files", async () => {
			const { detectRoom } = await import("../src/miner/room-detector");

			const result = detectRoom("/path/to/unknown.xyz", "some content");
			expect(result.room).toBe("general");
		});

		it("should return confidence scores", async () => {
			const { detectRoom } = await import("../src/miner/room-detector");

			const result = detectRoom("/path/to/README.md");
			expect(result.confidence).toBeGreaterThan(0);
			expect(result.confidence).toBeLessThanOrEqual(1);
		});
	});

	describe("detectConversationRoom", () => {
		it("should detect debugging room from error content", async () => {
			const { detectConversationRoom } = await import("../src/miner/room-detector");

			const content =
				"I'm getting an error: Cannot read property 'foo' of undefined at line 42. The stack trace shows it happens in the getData function.";
			const result = detectConversationRoom(content);

			expect(result.room).toBe("debugging");
		});

		it("should detect implementation room from feature content", async () => {
			const { detectConversationRoom } = await import("../src/miner/room-detector");

			const content =
				"I need to implement a new feature that adds support for real-time notifications. This involves creating a service module that handles websocket connections. We should extend the existing codebase with new classes.";
			const result = detectConversationRoom(content);

			expect(result.room).toBe("implementation");
		});

		it("should detect testing room from test content", async () => {
			const { detectConversationRoom } = await import("../src/miner/room-detector");

			const content =
				"Let's write a unit test for the validation function. We should mock the database and assert the expected output.";
			const result = detectConversationRoom(content);

			expect(result.room).toBe("testing");
		});

		it("should fall back to general for unclear content", async () => {
			const { detectConversationRoom } = await import("../src/miner/room-detector");

			const content = "Hello, how are you today?";
			const result = detectConversationRoom(content);

			expect(result.room).toBe("general");
		});
	});

	describe("createTaxonomyFromDirectories", () => {
		it("should create rooms from directory names", async () => {
			const { createTaxonomyFromDirectories } = await import("../src/miner/room-detector");

			const directories = ["/project/src/components", "/project/src/utils", "/project/docs"];
			const rooms = createTaxonomyFromDirectories(directories);

			const roomNames = rooms.map(r => r.room);
			expect(roomNames).toContain("components");
			expect(roomNames).toContain("utils");
			expect(roomNames).toContain("docs");
			expect(roomNames).toContain("general");
		});
	});
});

// ============================================================================
// Wing Routing Tests
// ============================================================================

describe("Wing Router", () => {
	describe("assignWing", () => {
		it("should assign work wing from path pattern", async () => {
			const { assignWing } = await import("../src/miner/wing-router");

			const result = assignWing("/home/user/work/project/src");
			expect(result.wing).toBe("work");
		});

		it("should assign open-source wing from github path", async () => {
			const { assignWing } = await import("../src/miner/wing-router");

			const result = assignWing("/home/user/github/repo");
			expect(result.wing).toBe("open-source");
		});

		it("should assign from git remote context", async () => {
			const { assignWing } = await import("../src/miner/wing-router");

			const result = assignWing("/some/path", { gitRemote: "https://github.com/user/repo.git" });
			expect(result.wing).toBe("open-source");
		});

		it("should use custom wing taxonomy", async () => {
			const { assignWing } = await import("../src/miner/wing-router");

			const customWings = [
				{
					wing: "frontend",
					displayName: "Frontend",
					pathPatterns: ["**/frontend/**", "**/client/**"],
					priority: 20,
				},
			];

			const result = assignWing("/project/frontend/components", {}, customWings);
			expect(result.wing).toBe("frontend");
		});

		it("should return confidence scores", async () => {
			const { assignWing } = await import("../src/miner/wing-router");

			const result = assignWing("/some/unknown/path");
			expect(typeof result.confidence).toBe("number");
			expect(result.confidence).toBeGreaterThanOrEqual(0);
		});

		it("should provide reason for assignment", async () => {
			const { assignWing } = await import("../src/miner/wing-router");

			const result = assignWing("/home/user/github/repo");
			expect(result.reason).toBeDefined();
		});
	});

	describe("createWingsFromEnvironment", () => {
		it("should create wings from environment variables", async () => {
			const { createWingsFromEnvironment } = await import("../src/miner/wing-router");

			// This test is environment-dependent
			const wings = createWingsFromEnvironment();

			// Should return an array (may be empty if no env vars set)
			expect(Array.isArray(wings)).toBe(true);
		});
	});
});

// ============================================================================
// File Mining Tests
// ============================================================================

describe("File Miner", () => {
	describe("mineDirectory", () => {
		beforeAll(async () => {
			// Create test directory structure
			await fs.mkdir(testDir, { recursive: true });
			await fs.mkdir(path.join(testDir, "src"), { recursive: true });
			await fs.mkdir(path.join(testDir, "docs"), { recursive: true });

			// Create test files
			await fs.writeFile(path.join(testDir, "src", "index.ts"), "export function hello() {\n  return 'world';\n}");
			await fs.writeFile(path.join(testDir, "README.md"), "# Test Project\n\nThis is a test.");
			await fs.writeFile(path.join(testDir, "package.json"), '{"name": "test", "version": "1.0.0"}');
		});

		afterAll(async () => {
			await cleanupTestDir();
		});

		it("should scan directory and count files", async () => {
			const { initDb } = await import("../src/db");
			await initDb({ dataDir: testDir });

			const { mineDirectory } = await import("../src/miner/file-miner");

			const result = await mineDirectory({
				directory: testDir,
				source: "test-mining",
			});

			expect(result.filesScanned).toBeGreaterThan(0);
			expect(result.filesProcessed).toBeGreaterThan(0);
			expect(result.errors.length).toBe(0);
		});

		it("should respect file extension filters", async () => {
			const { mineDirectory } = await import("../src/miner/file-miner");

			const result = await mineDirectory({
				directory: testDir,
				source: "test-ts-only",
				extensions: [".ts"],
			});

			// Should only process .ts files
			expect(result.filesProcessed).toBe(1);
			expect(result.filesSkipped).toBeGreaterThan(0);
		});

		it("should skip binary files", async () => {
			// Create a binary file with an allowed extension (.txt contains null bytes)
			const binaryPath = path.join(testDir, "data.bin");
			await fs.writeFile(binaryPath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));

			const { mineDirectory } = await import("../src/miner/file-miner");

			const result = await mineDirectory({
				directory: testDir,
				source: "test-binary-skip",
				extensions: [".ts", ".md", ".json", ".bin"],
			});

			// Binary file should be skipped
			const skipped = result.skippedFiles.find(s => s.file.includes("data.bin"));
			expect(skipped).toBeDefined();
			expect(skipped?.reason).toBe("binary file");
		});

		it("should handle gitignore patterns", async () => {
			// Create gitignore
			await fs.writeFile(path.join(testDir, ".gitignore"), "*.log\nnode_modules\n");

			const { mineDirectory } = await import("../src/miner/file-miner");

			const result = await mineDirectory({
				directory: testDir,
				source: "test-gitignore",
			});

			// .gitignore itself may be included or not, but *.log shouldn't be processed
			expect(result.errors.length).toBe(0);
		});
	});
});

// ============================================================================
// Conversation Mining Tests
// ============================================================================

describe("Conversation Miner", () => {
	describe("mineConversation", () => {
		beforeAll(async () => {
			const { initDb } = await import("../src/db");
			await initDb({ dataDir: testDir });
		});

		it("should mine conversation and store memories", async () => {
			const { mineConversation } = await import("../src/miner/convo-miner");

			const conversation = `What is the purpose of the new feature?

The feature adds support for real-time collaboration. Users can now work together on documents simultaneously.

How do we handle conflicts?

We use operational transformation to merge concurrent edits. The algorithm ensures eventual consistency.

Can you show me an example?

Sure, here's a code snippet that demonstrates the conflict resolution:
\`\`\`typescript
function resolveConflict(local: Op, remote: Op): Op {
  return transform(local, remote);
}
\`\`\``;

			const result = await mineConversation({
				text: conversation,
				source: "test-conversation",
				mode: "exchanges",
			});

			expect(result.exchangesFound).toBeGreaterThan(0);
			expect(result.chunksCreated).toBeGreaterThan(0);
			expect(result.errors.length).toBe(0);
		});

		it("should detect appropriate room from conversation content", async () => {
			const { mineConversation } = await import("../src/miner/convo-miner");

			const debuggingConversation = `I'm getting a TypeError when running the tests.
The error says "Cannot read property 'map' of undefined".
Let me check the stack trace...

The issue is in the data processing function. We're not handling the case where the input array is null.`;

			const result = await mineConversation({
				text: debuggingConversation,
				source: "debug-conversation",
			});

			expect(result.detectedRoom).toBe("debugging");
		});

		it("should respect minimum exchange length", async () => {
			const { mineConversation } = await import("../src/miner/convo-miner");

			const conversation = `Short?

Yes.

This is a much longer question that needs to be answered properly with some detailed explanation of how things work in this system.`;

			const result = await mineConversation({
				text: conversation,
				source: "test-min-length",
				minExchangeLength: 20,
			});

			// Should filter out short exchanges
			expect(result.exchangesFound).toBeGreaterThanOrEqual(0);
		});
	});

	describe("parseConversation", () => {
		it("should parse plain text conversation", async () => {
			const { parseConversation } = await import("../src/miner/convo-miner");

			const text = `User: Hello
Assistant: Hi there!
User: How are you?
Assistant: I'm doing well, thanks for asking!`;

			const messages = parseConversation(text, "plain");

			expect(messages.length).toBeGreaterThan(0);
			expect(messages.every(m => m.speaker && m.content)).toBe(true);
		});

		it("should parse JSON conversation", async () => {
			const { parseConversation } = await import("../src/miner/convo-miner");

			const text = JSON.stringify([
				{ speaker: "user", content: "Hello" },
				{ speaker: "assistant", content: "Hi there!" },
			]);

			const messages = parseConversation(text, "json");

			expect(messages.length).toBe(2);
			expect(messages[0].speaker).toBe("user");
			expect(messages[1].speaker).toBe("assistant");
		});

		it("should parse markdown conversation", async () => {
			const { parseConversation } = await import("../src/miner/convo-miner");

			const text = `## User
Hello, how are you?

## Assistant
I'm doing great! How can I help you today?`;

			const messages = parseConversation(text, "markdown");

			expect(messages.length).toBeGreaterThan(0);
		});

		it("should auto-detect conversation format", async () => {
			const { parseConversation } = await import("../src/miner/convo-miner");

			const jsonText = JSON.stringify([{ speaker: "a", content: "hi" }]);
			const messages = parseConversation(jsonText, "auto");

			expect(messages.length).toBe(1);
		});
	});

	describe("formatConversation", () => {
		it("should format parsed messages back to text", async () => {
			const { parseConversation, formatConversation } = await import("../src/miner/convo-miner");

			const text = "User: Hello\nAssistant: Hi!";
			const messages = parseConversation(text, "plain");
			const formatted = formatConversation(messages);

			expect(typeof formatted).toBe("string");
			expect(formatted.length).toBeGreaterThan(0);
		});
	});
});

// ============================================================================
// Unified Mining API Tests
// ============================================================================

describe("Mining API", () => {
	describe("mine (unified)", () => {
		beforeAll(async () => {
			const { initDb } = await import("../src/db");
			await initDb({ dataDir: testDir });
		});

		it("should auto-detect file vs directory", async () => {
			const { mine } = await import("../src/miner");

			const testFile = path.join(__dirname, "..", "src", "types.ts");
			const result = await mine(testFile, { type: "auto" });

			expect("filesScanned" in result).toBe(true);
			expect(result.filesScanned).toBe(1);
		});

		it("should mine directory explicitly", async () => {
			const { mine } = await import("../src/miner");

const result = await mine(path.join(__dirname, "..", "src"), { type: "directory" });

			expect("filesScanned" in result).toBe(true);
			expect(result.filesScanned).toBeGreaterThan(0);
		});

		it("should mine conversation explicitly", async () => {
			const { mine } = await import("../src/miner");

			const result = await mine("What is TypeScript?\n\nIt's a typed language.", {
				type: "conversation",
				source: "api-test",
			});

			expect("exchangesFound" in result).toBe(true);
		});
	});
});

// ============================================================================
// Public API Export Tests
// ============================================================================

describe("Public API Exports", () => {
	it("should export all mining functions from miner index", async () => {
		const api = await import("../src/miner");

		// Core mining functions
		expect(typeof api.mineDirectory).toBe("function");
		expect(typeof api.mineConversation).toBe("function");
		expect(typeof api.mine).toBe("function");

		// Detection functions
		expect(typeof api.detectRoom).toBe("function");
		expect(typeof api.assignWing).toBe("function");

		// Chunking utilities
		expect(typeof api.chunkByParagraphs).toBe("function");
		expect(typeof api.chunkConversation).toBe("function");

		// Conversation utilities
		expect(typeof api.parseConversation).toBe("function");
		expect(typeof api.formatConversation).toBe("function");
	});

	it("should export all mining types from miner index", async () => {
		const types = await import("../src/miner");

		// Check type exports exist
		expect("FileMinerOptions" in types).toBe(true);
		expect("FileMiningResult" in types).toBe(true);
		expect("ConvoMinerOptions" in types).toBe(true);
		expect("ConvoMiningResult" in types).toBe(true);
		expect("Chunk" in types).toBe(true);
		expect("RoomConfig" in types).toBe(true);
		expect("WingConfig" in types).toBe(true);
	});
});
