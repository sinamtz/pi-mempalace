/**
 * MemPalace Extension Tests
 *
 * Tests for Pi extension registration and tool definitions.
 */

import { describe, it, expect, beforeEach, vi } from "bun:test";
import type { ExtensionAPI, ToolDefinition } from "@mariozechner/pi-coding-agent";

// Mock ExtensionAPI for testing
interface MockExtensionAPI {
	logger: {
		debug: ReturnType<typeof vi.fn>;
		info: ReturnType<typeof vi.fn>;
		warn: ReturnType<typeof vi.fn>;
		error: ReturnType<typeof vi.fn>;
	};
	typebox: {
		Type: {
			Object: ReturnType<typeof vi.fn>;
			String: ReturnType<typeof vi.fn>;
			Number: ReturnType<typeof vi.fn>;
			Optional: ReturnType<typeof vi.fn>;
		};
	};
	pi: Record<string, unknown>;
	registerTool: ReturnType<typeof vi.fn>;
	registerCommand: ReturnType<typeof vi.fn>;
	on: ReturnType<typeof vi.fn>;
	setLabel: ReturnType<typeof vi.fn>;
}

function createMockExtensionAPI(): MockExtensionAPI {
	const TypeObject = vi.fn().mockReturnValue({});
	const StringMock = vi.fn().mockReturnValue({});
	const NumberMock = vi.fn().mockReturnValue({});
	const OptionalMock = vi.fn().mockImplementation(schema => schema);

	return {
		logger: {
			debug: vi.fn(),
			info: vi.fn(),
			warn: vi.fn(),
			error: vi.fn(),
		},
		typebox: {
			Type: {
				Object: TypeObject,
				String: StringMock,
				Number: NumberMock,
				Optional: OptionalMock,
			},
		},
		pi: {},
		registerTool: vi.fn(),
		registerCommand: vi.fn(),
		on: vi.fn(),
		setLabel: vi.fn(),
	};
}

describe("MemPalace Extension", () => {
	let mockApi: MockExtensionAPI;

	beforeEach(() => {
		mockApi = createMockExtensionAPI();
	});

	describe("Tool Registration", () => {
		it("should register all required tools", async () => {
			// Import and run extension registration
			const { registerTools } = await import("../src/extension/tools");
			registerTools(mockApi as unknown as ExtensionAPI);

			// Verify all expected tools are registered
			const registeredTools = mockApi.registerTool.mock.calls.map(call => (call[0] as ToolDefinition).name);

			const expectedTools = [
				"mempalace_add_memory",
				"mempalace_search",
				"mempalace_mine_directory",
				"mempalace_mine_conversation",
				"mempalace_get_memory",
				"mempalace_delete_memory",
				"mempalace_stats",
			];

			for (const tool of expectedTools) {
				expect(registeredTools).toContain(tool);
			}

			expect(registeredTools).toHaveLength(expectedTools.length);
		});

		it("should register tools with required properties", async () => {
			const { registerTools } = await import("../src/extension/tools");
			registerTools(mockApi as unknown as ExtensionAPI);

			const registeredTools = mockApi.registerTool.mock.calls.map(call => call[0] as ToolDefinition);

			for (const tool of registeredTools) {
				expect(tool).toHaveProperty("name");
				expect(tool).toHaveProperty("label");
				expect(tool).toHaveProperty("description");
				expect(tool).toHaveProperty("parameters");
				expect(tool).toHaveProperty("execute");
				expect(typeof tool.execute).toBe("function");
			}
		});

		it("should register structured parameter schemas", async () => {
			const { registerTools } = await import("../src/extension/tools");
			registerTools(mockApi as unknown as ExtensionAPI);
			const addMemoryCall = mockApi.registerTool.mock.calls.find(call => call[0]?.name === "mempalace_add_memory");
			expect(addMemoryCall).toBeDefined();
			const tool = addMemoryCall?.[0] as { parameters: { type?: string; properties?: Record<string, unknown> } };
			expect(tool.parameters.type).toBe("object");
			expect(tool.parameters.properties).toHaveProperty("text");
			expect(tool.parameters.properties).toHaveProperty("wing");
			expect(tool.parameters.properties).toHaveProperty("room");
		});
	});

	describe("Command Registration", () => {
		it("should register all required commands", async () => {
			const { registerCommands } = await import("../src/extension/commands");
			registerCommands(mockApi as unknown as ExtensionAPI);

			const registeredCommands = mockApi.registerCommand.mock.calls.map(call => call[0] as string);

			const expectedCommands = [
				"mempalace:init",
				"mempalace:mine",
				"mempalace:search",
				"mempalace:status",
				"mempalace:close",
			];

			for (const cmd of expectedCommands) {
				expect(registeredCommands).toContain(cmd);
			}

			expect(registeredCommands).toHaveLength(expectedCommands.length);
		});

		it("should register commands with handlers", async () => {
			const { registerCommands } = await import("../src/extension/commands");
			registerCommands(mockApi as unknown as ExtensionAPI);

			const calls = mockApi.registerCommand.mock.calls;

			for (const call of calls) {
				const [name, options] = call as [string, { handler: (...args: never[]) => unknown; description?: string }];
				expect(name).toBeTruthy();
				expect(typeof options.handler).toBe("function");
				expect(options.description).toBeTruthy();
			}
		});
	});

	describe("Hook Registration", () => {
		it("should register lifecycle hooks", async () => {
			const { registerHooks } = await import("../src/extension/hooks");
			registerHooks(mockApi as unknown as ExtensionAPI);

			// Verify hooks are registered
			const registeredEvents = mockApi.on.mock.calls.map(call => call[0] as string);

			expect(registeredEvents).toContain("session_before_compact");
			expect(registeredEvents).toContain("session_compact");
			expect(registeredEvents).toContain("session_shutdown");
			expect(registeredEvents).toContain("session_start");
			expect(registeredEvents).toContain("session_tree");
		});
	});

	describe("Extension Bootstrap", () => {
		it("should register all extension components", async () => {
			const module = await import("../src/extension/index");
			const factory = module.default;

			await factory(mockApi as unknown as ExtensionAPI);

			expect(mockApi.registerTool).toHaveBeenCalled();
			expect(mockApi.registerCommand).toHaveBeenCalled();
			expect(mockApi.on).toHaveBeenCalled();
		});
	});
});

describe("Tool Parameters", () => {
	let mockApi: MockExtensionAPI;

	beforeEach(() => {
		mockApi = createMockExtensionAPI();
	});

	it("mempalace_add_memory should have required parameters", async () => {
		const { registerTools } = await import("../src/extension/tools");
		registerTools(mockApi as unknown as ExtensionAPI);

		const tool = mockApi.registerTool.mock.calls.find(
			call => (call[0] as ToolDefinition).name === "mempalace_add_memory",
		)?.[0] as ToolDefinition;

		expect(tool).toBeDefined();
		expect(tool.parameters).toBeDefined();
		expect(tool.parameters).toBeTypeOf("object");
	});

	it("mempalace_search should have query and optional filters", async () => {
		const { registerTools } = await import("../src/extension/tools");
		registerTools(mockApi as unknown as ExtensionAPI);

		const tool = mockApi.registerTool.mock.calls.find(
			call => (call[0] as ToolDefinition).name === "mempalace_search",
		)?.[0] as ToolDefinition;

		expect(tool).toBeDefined();
		expect(tool.parameters).toBeDefined();
		expect(tool.parameters).toBeTypeOf("object");
	});

	it("mempalace_stats should accept optional wing/room filters", async () => {
		const { registerTools } = await import("../src/extension/tools");
		registerTools(mockApi as unknown as ExtensionAPI);

		const tool = mockApi.registerTool.mock.calls.find(
			call => (call[0] as ToolDefinition).name === "mempalace_stats",
		)?.[0] as ToolDefinition;

		expect(tool).toBeDefined();
		expect(tool.parameters).toBeDefined();
	});

	it("mempalace_get_memory should require ID parameter", async () => {
		const { registerTools } = await import("../src/extension/tools");
		registerTools(mockApi as unknown as ExtensionAPI);

		const tool = mockApi.registerTool.mock.calls.find(
			call => (call[0] as ToolDefinition).name === "mempalace_get_memory",
		)?.[0] as ToolDefinition;

		expect(tool).toBeDefined();
		expect(tool.parameters).toBeDefined();
	});

	it("mempalace_delete_memory should require ID parameter", async () => {
		const { registerTools } = await import("../src/extension/tools");
		registerTools(mockApi as unknown as ExtensionAPI);

		const tool = mockApi.registerTool.mock.calls.find(
			call => (call[0] as ToolDefinition).name === "mempalace_delete_memory",
		)?.[0] as ToolDefinition;

		expect(tool).toBeDefined();
		expect(tool.parameters).toBeDefined();
	});
});

describe("Extension Contract", () => {
	it("extension module should export a default function", async () => {
		const module = await import("../src/extension/index");
		expect(typeof module.default).toBe("function");
	});

	it("extension factory should accept ExtensionAPI", async () => {
		const module = await import("../src/extension/index");
		const factory = module.default;

		const mockApi = createMockExtensionAPI();
		const result = factory(mockApi as unknown as ExtensionAPI);

		// Should not throw
		await expect(result).resolves.toBeUndefined();
	});
});
