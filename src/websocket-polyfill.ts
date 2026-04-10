/**
 * WebSocket polyfill for Node.js environments where globalThis.WebSocket is undefined.
 *
 * SurrealDB uses `globalThis.WebSocket` as a fallback when `websocketImpl` is not passed.
 * Node.js 20+ requires --experimental-websocket to expose globalThis.WebSocket natively.
 * This polyfill imports the `ws` package and assigns it to globalThis.WebSocket.
 */

import type WebSocket from "ws";

// Only polyfill if native WebSocket is not available
if (typeof globalThis.WebSocket === "undefined") {
	const { default: WS } = await import("ws");
	(globalThis as typeof globalThis & { WebSocket: typeof WS }).WebSocket = WS;
}

// Extend global types so TypeScript knows about the polyfill
declare global {
	// eslint-disable-next-line no-var
	var WebSocket: typeof WebSocket;
}
