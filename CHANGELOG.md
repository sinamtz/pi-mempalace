# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

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

- Data-directory isolation now works correctly across multiple processes.
- Multi-process startup races now fall back cleanly to connecting to an already-started server.
- Memory writes handle SurrealKV transaction conflicts more safely.
- SurrealDB v3 query/schema compatibility issues were resolved for vector search and timestamp fields.
- Path handling now expands configured home-directory paths correctly instead of creating literal `~/` directories.
