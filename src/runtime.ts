import * as fs from "node:fs";
import * as fsPromises from "node:fs/promises";
import * as path from "node:path";
import { spawn } from "node:child_process";
import * as timers from "node:timers/promises";
import * as zlib from "node:zlib";
import { promisify } from "node:util";

const gunzip = promisify(zlib.gunzip);
const bunRuntime = typeof Bun !== "undefined" ? Bun : undefined;

export interface BackgroundProcess {
	pid: number | undefined;
	kill(): void;
}

interface RuntimeAdapter {
	sleep(ms: number): Promise<void>;
	which(command: string): Promise<string | null>;
	parseConfigText(text: string): unknown;
	stringifyConfigText(value: unknown): string;
	spawnBackground(command: string, args: string[]): BackgroundProcess;
}

const runtime: RuntimeAdapter = bunRuntime ? createBunRuntime() : createNodeRuntime();

export const sleep = runtime.sleep;
export const which = runtime.which;
export const parseConfigText = runtime.parseConfigText;
export const stringifyConfigText = runtime.stringifyConfigText;
export const spawnBackground = runtime.spawnBackground;

export async function writeFile(pathname: string, data: string | Uint8Array): Promise<void> {
	await fsPromises.writeFile(pathname, data);
}

export async function gunzipBytes(bytes: Uint8Array): Promise<Uint8Array> {
	const buffer = await gunzip(bytes);
	return new Uint8Array(buffer);
}

function createBunRuntime(): RuntimeAdapter {
	return {
		sleep(ms: number): Promise<void> {
			return bunRuntime!.sleep(ms);
		},

		async which(command: string): Promise<string | null> {
			return bunRuntime!.which(command) ?? null;
		},

		parseConfigText(text: string): unknown {
			return bunRuntime!.JSON5.parse(text);
		},

		stringifyConfigText(value: unknown): string {
			return bunRuntime!.JSON5.stringify(value) ?? JSON.stringify(value, null, 2);
		},

		spawnBackground(command: string, args: string[]): BackgroundProcess {
			const process = bunRuntime!.spawn([command, ...args], {
				stdin: "ignore",
				stdout: "ignore",
				stderr: "ignore",
			});
			return {
				pid: process.pid,
				kill(): void {
					process.kill();
				},
			};
		},
	};
}

function createNodeRuntime(): RuntimeAdapter {
	return {
		async sleep(ms: number): Promise<void> {
			await timers.setTimeout(ms);
		},

		which(command: string): Promise<string | null> {
			return findExecutableOnPath(command);
		},

		parseConfigText(text: string): unknown {
			return JSON.parse(text);
		},

		stringifyConfigText(value: unknown): string {
			return JSON.stringify(value, null, 2);
		},

		spawnBackground(command: string, args: string[]): BackgroundProcess {
			const process = spawn(command, args, {
				stdio: ["ignore", "ignore", "ignore"],
			});
			return {
				pid: process.pid,
				kill(): void {
					process.kill();
				},
			};
		},
	};
}

async function findExecutableOnPath(command: string): Promise<string | null> {
	if (command.includes(path.sep) || (path.sep === "\\" && command.includes("/"))) {
		return (await isExecutable(command)) ? command : null;
	}

	const pathValue = process.env.PATH;
	if (!pathValue) {
		return null;
	}

	const extensions =
		process.platform === "win32"
			? (process.env.PATHEXT?.split(";").filter(Boolean) ?? [".exe", ".cmd", ".bat"])
			: [""];

	for (const directory of pathValue.split(path.delimiter)) {
		for (const extension of extensions) {
			const candidate = path.join(
				directory,
				process.platform === "win32" ? appendWindowsExtension(command, extension) : command,
			);
			if (await isExecutable(candidate)) {
				return candidate;
			}
		}
	}

	return null;
}

function appendWindowsExtension(command: string, extension: string): string {
	if (command.toLowerCase().endsWith(extension.toLowerCase())) {
		return command;
	}
	return `${command}${extension}`;
}

async function isExecutable(pathname: string): Promise<boolean> {
	try {
		await fsPromises.access(pathname, process.platform === "win32" ? fs.constants.F_OK : fs.constants.X_OK);
		return true;
	} catch {
		return false;
	}
}
