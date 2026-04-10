import { describe, expect, test } from "vitest"
import {
	SURREAL_VERSION,
	getManagedSurrealBinaryPath,
	getSurrealDownloadUrl,
	getSurrealPlatformSpec,
} from "../src/surreal-binary";

describe("getSurrealPlatformSpec", () => {
	test("maps linux x64 to the official linux amd64 tarball", () => {
		expect(getSurrealPlatformSpec("linux", "x64")).toEqual({
			os: "linux",
			arch: "amd64",
			extension: "tgz",
			binaryName: "surreal",
		});
	});

	test("maps darwin arm64 to the official darwin arm64 tarball", () => {
		expect(getSurrealPlatformSpec("darwin", "arm64")).toEqual({
			os: "darwin",
			arch: "arm64",
			extension: "tgz",
			binaryName: "surreal",
		});
	});

	test("maps windows x64 to the official windows amd64 executable", () => {
		expect(getSurrealPlatformSpec("win32", "x64")).toEqual({
			os: "windows",
			arch: "amd64",
			extension: "exe",
			binaryName: "surreal.exe",
		});
	});

	test("rejects unsupported platforms", () => {
		expect(() => getSurrealPlatformSpec("freebsd", "x64")).toThrow("Unsupported operating system");
	});
});

describe("download and cache paths", () => {
	test("builds the official download URL", () => {
		const spec = getSurrealPlatformSpec("darwin", "arm64");
		expect(getSurrealDownloadUrl(spec)).toBe(
			`https://download.surrealdb.com/${SURREAL_VERSION}/surreal-${SURREAL_VERSION}.darwin-arm64.tgz`,
		);
	});

	test("stores the managed binary under ~/.mempalace/bin/<version>/<os>-<arch>", () => {
		const spec = getSurrealPlatformSpec("linux", "x64");
		expect(getManagedSurrealBinaryPath("/tmp/home", spec)).toBe(
			`/tmp/home/.mempalace/bin/${SURREAL_VERSION}/linux-amd64/surreal`,
		);
	});
});
