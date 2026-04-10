/**
 * Platform-aware SurrealDB binary resolution.
 *
 * Resolution order:
 * 1. Explicit config / env override (`surrealBin`, `MEMPALACE_SURREAL_BIN`)
 * 2. `surreal` already available on PATH
 * 3. Managed per-user binary in `~/.mempalace/bin/<version>/<os>-<arch>/`
 *    - downloaded on first use from the official SurrealDB release host
 */

import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { isEexist, isEnoent } from "./fs-error";
import { logger } from "./logger";
import { gunzipBytes, sleep, which, writeFile } from "./runtime";
import type { Config } from "./config";

export const SURREAL_VERSION = "v3.0.5";
const SURREAL_DOWNLOAD_ROOT = "https://download.surrealdb.com";
const DOWNLOAD_LOCK_TIMEOUT_MS = 60_000;
const DOWNLOAD_LOCK_POLL_MS = 200;

type SurrealOs = "linux" | "darwin" | "windows";
type SurrealArch = "amd64" | "arm64";

export interface SurrealPlatformSpec {
	os: SurrealOs;
	arch: SurrealArch;
	extension: "tgz" | "exe";
	binaryName: "surreal" | "surreal.exe";
}

export function getSurrealPlatformSpec(platform = process.platform, arch = process.arch): SurrealPlatformSpec {
	const surrealOs = mapSurrealOs(platform);
	const surrealArch = mapSurrealArch(arch);

	return {
		os: surrealOs,
		arch: surrealArch,
		extension: surrealOs === "windows" ? "exe" : "tgz",
		binaryName: surrealOs === "windows" ? "surreal.exe" : "surreal",
	};
}

export function getSurrealDownloadUrl(spec = getSurrealPlatformSpec()): string {
	return `${SURREAL_DOWNLOAD_ROOT}/${SURREAL_VERSION}/surreal-${SURREAL_VERSION}.${spec.os}-${spec.arch}.${spec.extension}`;
}

export function getManagedSurrealBinaryPath(
	homeDir = process.env.HOME ?? os.homedir(),
	spec = getSurrealPlatformSpec(),
): string {
	return path.join(homeDir, ".mempalace", "bin", SURREAL_VERSION, `${spec.os}-${spec.arch}`, spec.binaryName);
}

export async function resolveSurrealBinary(config: Config): Promise<string> {
	const configuredBinary = await resolveConfiguredBinary(config);
	if (configuredBinary) {
		if (await pathExists(configuredBinary)) {
			logger.debug("Using configured SurrealDB binary", { path: configuredBinary });
			return configuredBinary;
		}
		throw new Error(`Configured SurrealDB binary not found: ${configuredBinary}`);
	}

	const systemBinary = await which("surreal");
	if (systemBinary) {
		logger.debug("Using SurrealDB binary from PATH", { path: systemBinary });
		return systemBinary;
	}

	const managedBinary = getManagedSurrealBinaryPath();
	if (await pathExists(managedBinary)) {
		logger.debug("Using managed SurrealDB binary", { path: managedBinary });
		return managedBinary;
	}

	await ensureManagedSurrealBinary(managedBinary);
	logger.info("Managed SurrealDB binary ready", { path: managedBinary });
	return managedBinary;
}

function mapSurrealOs(platform: string): SurrealOs {
	switch (platform) {
		case "linux":
			return "linux";
		case "darwin":
			return "darwin";
		case "win32":
			return "windows";
		default:
			throw new Error(`Unsupported operating system for managed SurrealDB binary: ${platform}`);
	}
}

function mapSurrealArch(arch: string): SurrealArch {
	switch (arch) {
		case "arm64":
		case "aarch64":
			return "arm64";
		case "x64":
		case "x86_64":
		case "amd64":
			return "amd64";
		default:
			throw new Error(`Unsupported CPU architecture for managed SurrealDB binary: ${arch}`);
	}
}

async function resolveConfiguredBinary(config: Config): Promise<string | null> {
	const configured = process.env.MEMPALACE_SURREAL_BIN ?? config.surrealBin;
	if (!configured) {
		return null;
	}

	if (looksLikePath(configured)) {
		return path.resolve(configured);
	}

	return await which(configured);
}

function looksLikePath(value: string): boolean {
	return (
		path.isAbsolute(value) ||
		value.startsWith("./") ||
		value.startsWith("../") ||
		value.includes("/") ||
		value.includes("\\")
	);
}

async function ensureManagedSurrealBinary(binaryPath: string): Promise<void> {
	const binaryDir = path.dirname(binaryPath);
	const lockPath = `${binaryPath}.lock`;
	await fs.mkdir(binaryDir, { recursive: true });

	if (await pathExists(binaryPath)) {
		return;
	}

	let lockHandle: fs.FileHandle | null = null;
	try {
		lockHandle = await fs.open(lockPath, "wx");
	} catch (err) {
		if (isEexist(err)) {
			await waitForManagedBinary(binaryPath, lockPath);
			return;
		}
		throw err;
	}

	try {
		if (!(await pathExists(binaryPath))) {
			await downloadManagedSurrealBinary(binaryPath);
		}
	} finally {
		await lockHandle.close();
		try {
			await fs.rm(lockPath, { force: true });
		} catch (err) {
			if (!isEnoent(err)) {
				logger.warn("Failed to remove SurrealDB download lock", { lockPath, error: String(err) });
			}
		}
	}
}

async function waitForManagedBinary(binaryPath: string, lockPath: string): Promise<void> {
	const startTime = Date.now();
	while (Date.now() - startTime < DOWNLOAD_LOCK_TIMEOUT_MS) {
		if (await pathExists(binaryPath)) {
			return;
		}

		if (!(await pathExists(lockPath))) {
			if (await pathExists(binaryPath)) {
				return;
			}
			break;
		}

		await sleep(DOWNLOAD_LOCK_POLL_MS);
	}

	throw new Error(`Timed out waiting for SurrealDB binary download: ${binaryPath}`);
}

async function downloadManagedSurrealBinary(binaryPath: string): Promise<void> {
	const spec = getSurrealPlatformSpec();
	const url = getSurrealDownloadUrl(spec);
	const tempPath = `${binaryPath}.${process.pid}.${Date.now()}.tmp`;

	logger.info("Downloading SurrealDB binary", {
		url,
		binaryPath,
		os: spec.os,
		arch: spec.arch,
	});

	const response = await fetch(url);
	if (!response.ok) {
		throw new Error(`Failed to download SurrealDB binary: ${response.status} ${response.statusText}`);
	}

	try {
		const responseBytes = new Uint8Array(await response.arrayBuffer());
		if (spec.extension === "exe") {
			await writeFile(tempPath, responseBytes);
		} else {
			const extractedBinary = extractTarEntry(await gunzipBytes(responseBytes), spec.binaryName);
			await writeFile(tempPath, extractedBinary);
		}

		if (spec.os !== "windows") {
			await fs.chmod(tempPath, 0o755);
		}

		await fs.rename(tempPath, binaryPath);
	} catch (err) {
		try {
			await fs.rm(tempPath, { force: true });
		} catch (cleanupErr) {
			if (!isEnoent(cleanupErr)) {
				throw cleanupErr;
			}
		}
		throw err;
	}
}

function extractTarEntry(archive: Uint8Array, binaryName: string): Uint8Array {
	let offset = 0;
	while (offset + 512 <= archive.length) {
		const header = archive.subarray(offset, offset + 512);
		const entryName = readTarString(header.subarray(0, 100));
		if (!entryName) {
			break;
		}

		const size = readTarOctal(header.subarray(124, 136));
		const dataStart = offset + 512;
		const dataEnd = dataStart + size;
		if (entryBasename(entryName) === binaryName) {
			return archive.slice(dataStart, dataEnd);
		}

		offset = dataStart + Math.ceil(size / 512) * 512;
	}

	throw new Error(`SurrealDB archive did not contain ${binaryName}`);
}

function readTarString(field: Uint8Array): string {
	const raw = new TextDecoder().decode(field);
	const nullIndex = raw.indexOf("\0");
	return (nullIndex === -1 ? raw : raw.slice(0, nullIndex)).trim();
}

function readTarOctal(field: Uint8Array): number {
	const raw = readTarString(field).trim();
	return raw ? parseInt(raw, 8) : 0;
}

function entryBasename(entryName: string): string {
	const parts = entryName.split("/");
	return parts[parts.length - 1] ?? entryName;
}

async function pathExists(targetPath: string): Promise<boolean> {
	try {
		await fs.stat(targetPath);
		return true;
	} catch (err) {
		if (isEnoent(err)) {
			return false;
		}
		throw err;
	}
}
