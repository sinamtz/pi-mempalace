/**
 * File system error utilities.
 *
 * Provides helpers for detecting common error conditions
 * when working with file system operations.
 */

/** Common error codes */
type ErrnoCode = "ENOENT" | "EACCES" | "EEXIST" | string;

/**
 * Check if an error is a "file not found" error (ENOENT).
 *
 * @param error - The error to check.
 * @returns True if this is an ENOENT error.
 */
export function isEnoent(error: unknown): boolean {
	if (error instanceof Error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "ENOENT" || error.message.includes("no such file or directory");
	}
	if (typeof error === "object" && error !== null) {
		const code = (error as { code?: ErrnoCode }).code;
		return code === "ENOENT";
	}
	return false;
}

/**
 * Check if an error is a permission denied error (EACCES).
 *
 * @param error - The error to check.
 * @returns True if this is an EACCES error.
 */
export function isEacces(error: unknown): boolean {
	if (error instanceof Error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "EACCES";
	}
	if (typeof error === "object" && error !== null) {
		const code = (error as { code?: ErrnoCode }).code;
		return code === "EACCES";
	}
	return false;
}

/**
 * Check if an error is an exists error (EEXIST).
 *
 * @param error - The error to check.
 * @returns True if this is an EEXIST error.
 */
export function isEexist(error: unknown): boolean {
	if (error instanceof Error) {
		const code = (error as NodeJS.ErrnoException).code;
		return code === "EEXIST";
	}
	if (typeof error === "object" && error !== null) {
		const code = (error as { code?: ErrnoCode }).code;
		return code === "EEXIST";
	}
	return false;
}
