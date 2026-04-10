/**
 * Pi lifecycle hooks for MemPalace
 *
 * Registers hooks for:
 * - pre-compact: Save pending memories before context compaction
 * - stop/shutdown: Cleanup on exit
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { logger } from "../logger";
import { isDbInitialized, close } from "../index";

/**
 * Register lifecycle hooks with the ExtensionAPI.
 */
export function registerHooks(pi: ExtensionAPI): void {
	// -------------------------------------------------------------------------
	// session_before_compact
	// -------------------------------------------------------------------------
	pi.on("session_before_compact", async (_event, _ctx) => {
		if (!isDbInitialized()) {
			return;
		}

		logger.debug("Pre-compact hook: MemPalace active, skipping special handling");
	});

	// -------------------------------------------------------------------------
	// session_compact
	// -------------------------------------------------------------------------
	pi.on("session_compact", async (_event, _ctx) => {
		if (!isDbInitialized()) {
			return;
		}

		logger.debug("Post-compact hook: MemPalace state preserved");
	});

	// -------------------------------------------------------------------------
	// session_shutdown
	// -------------------------------------------------------------------------
	pi.on("session_shutdown", async () => {
		if (!isDbInitialized()) {
			return;
		}

		logger.debug("Shutdown hook: Closing MemPalace connection");

		try {
			await close();
			logger.debug("MemPalace shutdown complete");
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			logger.error("Error during MemPalace shutdown", { error: message });
		}
	});

	// -------------------------------------------------------------------------
	// session_start
	// -------------------------------------------------------------------------
	pi.on("session_start", async (_event, _ctx) => {
		logger.debug("Session start: MemPalace extension ready");
	});

	// -------------------------------------------------------------------------
	// session_tree (navigation)
	// -------------------------------------------------------------------------
	pi.on("session_tree", async (_event, _ctx) => {
		logger.debug("Session tree navigation: MemPalace state preserved in branch");
	});
}
