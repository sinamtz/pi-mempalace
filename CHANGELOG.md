# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Fixed

- `closeAllDb` now uses hard timeouts on `db.close()` to prevent indefinite hangs when the SurrealDB WebSocket client gets stuck in a reconnect loop.
- Added SIGTERM/SIGINT/exit handlers to ensure orphan SurrealDB processes are cleaned up on worker termination.

### Changed

- `embedBatch` now processes embeddings sequentially instead of with unbounded `Promise.all`, preventing OOM from concurrent ONNX tensor accumulation.
- `mineDirectory` now uses `batchSize=1` to process files one at a time, avoiding concurrent file handle issues that caused V8 internal errors.
  This also keeps memory bounded — only one file's chunks are held in memory at a time.
- Removed the 5,000 file cap from `mineDirectory` — all files are now processed.
- `vitest.config.ts` updated to Vitest 4 syntax (removed deprecated `poolOptions`).
- `test/miner.test.ts` now properly closes DB connections and unloads the embedding model after each test suite.

## [0.2.3] - 2026-04-09

### Fixed

- WebSocket polyfill type incompatibility with `globalThis.WebSocket` in Node.js environments.

## [0.2.2] - 2026-04-09

### Fixed

- Fixed `const files` reassignment in `file-miner.ts` that caused a TypeScript error when truncating the file list on large repositories.

## [0.2.1] - 2026-04-09

### Fixed

- Fixed TUI corruption from logger stdout/stderr formatting.

## [0.2.0] - 2026-04-09

### Added

- First public release of **pi-mempalace**, a Pi extension for long-term semantic memory.
- SurrealDB-backed memory storage with HNSW vector search for semantic recall.
- Layered retrieval (identity, essential context, location-based recall, deep semantic search).
- Knowledge graph support for entities, relationships, and palace navigation.
- File and conversation mining for turning codebases and sessions into searchable memory.
- Auto-Server runtime that starts or connects to a shared SurrealDB process automatically.
- Managed SurrealDB binary resolution: configured path, `PATH`, or first-run download for the current platform.
- MIT `LICENSE` for npm distribution.

### Changed

- Package metadata, docs, and install flow are aligned for standalone npm publication as a Pi extension.
- Runtime now supports Node-compatible execution while preserving Bun fast paths through internal adapters.
- Package follows the Pi extension package model with raw TypeScript source and `pi.extensions` metadata.

### Fixed

- WebSocket polyfill for Node.js environments where `globalThis.WebSocket` is undefined (fixes `WebSocketImpl is not a constructor` in SurrealDB).
- Connection failures now throw a caught error with a descriptive message instead of crashing the process unhandled.
- Debug/info/warn logs now write to the file log only instead of console, preventing TUI corruption.
- Data-directory isolation now works correctly across multiple processes.
- Multi-process startup races now fall back cleanly to connecting to an already-started server.
- Memory writes handle SurrealKV transaction conflicts more safely.
- SurrealDB v3 query/schema compatibility issues were resolved for vector search and timestamp fields.
- Path handling now expands configured home-directory paths correctly instead of creating literal `~/` directories.
