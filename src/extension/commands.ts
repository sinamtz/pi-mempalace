/**
 * Slash Command Handlers for MemPalace
 *
 * Registers slash commands accessible via the command palette:
 * - /mempalace:init - Initialize palace
 * - /mempalace:mine - Mine current directory
 * - /mempalace:search - Search memories
 * - /mempalace:status - Show palace stats
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { AutocompleteItem } from "@mariozechner/pi-tui";
import { logger } from "../logger";
import { init, close } from "../index";
import { countMemories, listMemories, queryMemories } from "../memory";
import { embed } from "../embed";
import { mineDirectory } from "../miner";

/** Database initialized state */
let dbInitialized = false;

async function ensureDb(): Promise<void> {
	if (!dbInitialized) {
		await init();
		dbInitialized = true;
	}
}

/**
 * Sanitize text for safe TUI display.
 */
function sanitizeText(text: string, maxLength = 2000): string {
	return text.replace(/\t/g, "    ").slice(0, maxLength);
}

/**
 * Register all slash commands with the ExtensionAPI.
 */
export function registerCommands(pi: ExtensionAPI): void {
	// -------------------------------------------------------------------------
	// /mempalace:init
	// -------------------------------------------------------------------------
	pi.registerCommand("mempalace:init", {
		description: "Initialize the MemPalace database",
		handler: async (_args, ctx) => {
			if (!ctx.hasUI) {
				ctx.ui.notify("MemPalace: Initializing database...", "info");
			}

			try {
				await ensureDb();
				const count = await countMemories();

				ctx.ui.notify(`MemPalace initialized. ${count} memory(ies) in palace.`, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error("Failed to initialize MemPalace", { error: message });
				ctx.ui.notify(`MemPalace init failed: ${message}`, "error");
			}
		},
	});

	// -------------------------------------------------------------------------
	// /mempalace:mine
	// -------------------------------------------------------------------------
	pi.registerCommand("mempalace:mine", {
		description: "Mine the current directory into the memory palace",
		getArgumentCompletions: (argumentPrefix): AutocompleteItem[] | null => {
			if (!argumentPrefix) {
				return [
					{ value: "mine", label: "mine", description: "Mine current directory" },
					{ value: "mine --wing work", label: "--wing work", description: "Mine with 'work' wing" },
					{ value: "mine --wing personal", label: "--wing personal", description: "Mine with 'personal' wing" },
				];
			}
			return null;
		},
		handler: async (args, ctx) => {
			// Parse simple arguments
			const parts = args.trim().split(/\s+/);
			let wing: string | undefined;

			for (const part of parts) {
				if (part.startsWith("--wing=")) {
					wing = part.slice(7);
				} else if (part === "--wing" && parts.indexOf(part) < parts.length - 1) {
					const idx = parts.indexOf(part);
					wing = parts[idx + 1];
				}
			}

			ctx.ui.notify("MemPalace: Starting directory mining...", "info");

			try {
				await ensureDb();

				const result = await mineDirectory({
					directory: ctx.cwd,
					wing,
				});

				ctx.ui.notify(
					`Mining complete: ${result.memoriesStored} memories stored from ${result.filesProcessed} files.`,
					"info",
				);
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error("Directory mining failed", { error: message, directory: ctx.cwd });
				ctx.ui.notify(`Mining failed: ${message}`, "error");
			}
		},
	});

	// -------------------------------------------------------------------------
	// /mempalace:search
	// -------------------------------------------------------------------------
	pi.registerCommand("mempalace:search", {
		description: "Search memories in the palace",
		getArgumentCompletions: (): AutocompleteItem[] => {
			return [
				{ value: "search", label: "search", description: "Search memories" },
				{ value: 'search "query"', label: '"query"', description: "Search with specific query" },
				{ value: "search --limit 10", label: "--limit 10", description: "Return up to 10 results" },
			];
		},
		handler: async (args, ctx) => {
			// Get query from args or prompt user
			let query = args
				.trim()
				.replace(/^search\s*/i, "")
				.replace(/^["']|["']$/g, "");

			if (!query) {
				// Prompt for query
				const input = await ctx.ui.input("MemPalace Search", "Enter search query...");

				if (!input) {
					ctx.ui.notify("Search cancelled.", "info");
					return;
				}
				query = input;
			}

			// Parse options
			const parts = query.split(/\s+/);
			let searchQuery = "";
			let limit = 5;

			for (let i = 0; i < parts.length; i++) {
				const part = parts[i];
				if (part === "--limit" && i < parts.length - 1) {
					limit = parseInt(parts[i + 1], 10) || 5;
					i++;
				} else if (part.startsWith("--limit=")) {
					limit = parseInt(part.slice(8), 10) || 5;
				} else {
					searchQuery += (searchQuery ? " " : "") + part;
				}
			}

			if (!searchQuery) {
				ctx.ui.notify("No search query provided.", "warning");
				return;
			}

			ctx.ui.setWorkingMessage("Searching memories...");

			try {
				await ensureDb();

				const queryEmbedding = await embed(searchQuery);
				const results = await queryMemories(queryEmbedding, { limit });

				ctx.ui.setWorkingMessage(undefined);

				if (results.length === 0) {
					ctx.ui.notify("No matching memories found.", "info");
					return;
				}

				// Format results for display
				const lines = [`Found ${results.length} memory(ies):`, ""];

				for (const result of results) {
					const m = result.memory;
					lines.push(`[${(result.score * 100).toFixed(0)}%] ${m.wing}/${m.room}`, sanitizeText(m.text, 150), "");
				}

				ctx.ui.notify(lines.join("\n"), "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error("Memory search failed", { error: message, query: searchQuery });
				ctx.ui.setWorkingMessage(undefined);
				ctx.ui.notify(`Search failed: ${message}`, "error");
			}
		},
	});

	// -------------------------------------------------------------------------
	// /mempalace:status
	// -------------------------------------------------------------------------
	pi.registerCommand("mempalace:status", {
		description: "Show MemPalace status and statistics",
		handler: async (_args, ctx) => {
			try {
				await ensureDb();

				const totalCount = await countMemories();
				const recentMemories = await listMemories({ limit: 20 });

				// Group by wing
				const byWing: Record<string, number> = {};
				for (const m of recentMemories) {
					byWing[m.wing] = (byWing[m.wing] ?? 0) + 1;
				}

				const wingLines = Object.entries(byWing)
					.sort((a, b) => b[1] - a[1])
					.map(([wing, count]) => `  ${wing}: ${count}`)
					.join("\n");

				const message = [
					"MemPalace Status:",
					`Total memories: ${totalCount}`,
					"",
					"By Wing:",
					wingLines || "  (none)",
				].join("\n");

				ctx.ui.notify(message, "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error("Failed to get palace status", { error: message });
				ctx.ui.notify(`Status failed: ${message}`, "error");
			}
		},
	});

	// -------------------------------------------------------------------------
	// /mempalace:close
	// -------------------------------------------------------------------------
	pi.registerCommand("mempalace:close", {
		description: "Close the MemPalace database connection",
		handler: async (_args, ctx) => {
			try {
				await close();
				dbInitialized = false;
				ctx.ui.notify("MemPalace connection closed.", "info");
			} catch (error) {
				const message = error instanceof Error ? error.message : String(error);
				logger.error("Failed to close MemPalace", { error: message });
				ctx.ui.notify(`Close failed: ${message}`, "error");
			}
		},
	});
}
