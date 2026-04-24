/**
 * Centralized logger for MemPalace.
 *
 * Uses an injected host logger when one is available,
 * and falls back to console/file logging for standalone use.
 */

import * as fs from "node:fs/promises";
import * as path from "node:path";

/** Get the logs directory, defaulting to ~/.mempalace/logs/ */
function getLogsDir(): string {
	const home = process.env.HOME ?? "/tmp";
	return path.join(home, ".mempalace", "logs");
}

/** Ensure logs directory exists */
async function ensureLogsDir(): Promise<string> {
	const logsDir = getLogsDir();
	try {
		await fs.mkdir(logsDir, { recursive: true });
	} catch {
		// Ignore if already exists
	}
	return logsDir;
}

/** Log levels */
type LogLevel = "debug" | "info" | "warn" | "error";

/** Reset host logger cache — for testing only */
export function _resetOmpContext(): void {
	isOmpContext = null;
	ompLogger = null;
}

/** Host logger availability cache. */
let isOmpContext: boolean | null = null;

/** Check if a host logger is available. Exported for testing. */
export function checkOmpContext(): boolean {
	if (isOmpContext !== null) return isOmpContext;
	isOmpContext = false;
	return false;
}

/** Host logger interface */
interface OmpLogger {
	error: (message: string, context?: Record<string, unknown>) => void;
	warn: (message: string, context?: Record<string, unknown>) => void;
	info: (message: string, context?: Record<string, unknown>) => void;
	debug: (message: string, context?: Record<string, unknown>) => void;
}

/** No host logger integration is wired by default for the standalone package. */
async function getOmpLogger(): Promise<OmpLogger | null> {
	return null;
}

/** Singleton logger instance */
let ompLogger: OmpLogger | null = null;

let logsDirPromise: Promise<string> | null = null;

/** Get the current log file path, creating the logs directory if needed. */
async function getLogPath(): Promise<string> {
	logsDirPromise ??= ensureLogsDir();
	const logsDir = await logsDirPromise;
	const date = new Date().toISOString().split("T")[0];
	return path.join(logsDir, `mempalace.${date}.log`);
}

/** Write a log entry to file. */
async function writeLog(level: LogLevel, message: string, context?: Record<string, unknown>): Promise<void> {
	try {
		const entry: Record<string, unknown> = {
			timestamp: new Date().toISOString(),
			level,
			message,
			pid: process.pid,
		};

		if (context) {
			Object.assign(entry, context);
		}

		const line = `${JSON.stringify(entry)}\n`;
		await fs.appendFile(await getLogPath(), line);
	} catch {
		// Logging must never crash the host process.
	}
}

/**
 * Centralized logger interface.
 */
export interface Logger {
	error(message: string, context?: Record<string, unknown>): void;
	warn(message: string, context?: Record<string, unknown>): void;
	debug(message: string, context?: Record<string, unknown>): void;
	info(message: string, context?: Record<string, unknown>): void;
}

/** Initialize the host logger asynchronously */
async function initOmpLogger(): Promise<void> {
	if (ompLogger === null) {
		ompLogger = await getOmpLogger();
	}
}

// Initialize host logger in background
initOmpLogger().catch(() => {
	// Ignore initialization errors
});

/**
 * The MemPalace logger instance.
 */
export const logger: Logger = {
	error(message: string, context?: Record<string, unknown>): void {
		if (ompLogger) {
			ompLogger.error(message, context);
		} else {
			console.error(`[ERROR] ${message}`, context ?? {});
			writeLog("error", message, context);
		}
	},

	warn(message: string, context?: Record<string, unknown>): void {
		if (ompLogger) {
			ompLogger.warn(message, context);
		} else {
			writeLog("warn", message, context);
		}
	},

	debug(message: string, context?: Record<string, unknown>): void {
		if (ompLogger) {
			ompLogger.debug(message, context);
		}
		writeLog("debug", message, context);
	},

	info(message: string, context?: Record<string, unknown>): void {
		if (ompLogger) {
			ompLogger.info?.(message, context);
		} else {
			writeLog("info", message, context);
		}
	},
};
