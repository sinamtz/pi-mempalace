import { defineConfig } from "vitest/config";

export default defineConfig({
	test: {
		include: ["test/**/*.test.ts"],
		environment: "node",
		pool: "forks",
		forks: {
			singleFork: true,
		},
		teardownTimeout: 10000,
	},
});
