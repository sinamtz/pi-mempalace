/**
 * MemPalace Pi Extension Bootstrap
 *
 * Registers tools, commands, and hooks with the Pi coding agent.
 * This is the main entry point loaded by Pi when the extension is enabled.
 */

import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import { logger } from "../logger";
import { registerTools } from "./tools";
import { registerCommands } from "./commands";
import { registerHooks } from "./hooks";

/**
 * Initialize and register all extension components.
 */
export default async function mempalaceExtension(pi: ExtensionAPI): Promise<void> {
	logger.debug("MemPalace extension initializing");

	// Register tools
	registerTools(pi);

	// Register slash commands
	registerCommands(pi);

	// Register lifecycle hooks
	registerHooks(pi);

	logger.debug("MemPalace extension registered successfully");
}
