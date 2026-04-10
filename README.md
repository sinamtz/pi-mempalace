# pi-mempalace

> Semantic memory extension for Pi with vector search, knowledge graph retrieval, and automatic SurrealDB runtime management.

`pi-mempalace` gives Pi coding agents long-term memory backed by **SurrealDB**, **semantic embeddings**, and a **multi-process-safe Auto-Server runtime**. It stores code knowledge, conversations, debugging findings, architecture decisions, and project context so agents can recall what matters across sessions.

Built on the ideas from [milla-jovovich/mempalace](https://github.com/milla-jovovich/mempalace), this version focuses on **operational simplicity**, **fast local retrieval**, and **Pi-native installation**.

## Installation

Install as a Pi extension:

```bash
pi install npm:pi-mempalace
```

No Python environment. No separate vector database. No manual server startup.

## Why use pi-mempalace

- **Semantic memory for Pi agents** — recall related code, decisions, and conversations by meaning, not exact text
- **One local database for vectors, metadata, and graph queries** — semantic search, filters, and relationships live in one engine
- **Multi-process safe** — multiple Pi sessions can share the same memory store without manual coordination
- **Project isolation** — each data directory gets its own isolated memory instance, so different projects do not leak into each other
- **Automatic runtime** — resolves or downloads the right SurrealDB binary on first use
- **Local-first** — no required API calls for storage or retrieval

---

## What makes it different

The original [milla-jovovich/mempalace](https://github.com/milla-jovovich/mempalace) pioneered the palace metaphor for AI memory. This implementation carries the same ideas forward in a different technical direction.

### One engine for everything

SurrealDB handles vector search, relational metadata filtering, entity graphs, and temporal versioning in a single database.

That matters because semantic search, structural relationships, and metadata filters are not split across multiple systems. The agent can search by meaning, constrain by location, and follow graph links without switching stores or rebuilding context in application code.

### Architecture at a glance

| Concern | Original MemPalace direction | pi-mempalace |
|---|---|---|
| Semantic search | Vector-store centered | SurrealDB HNSW index |
| Metadata filters | Separate application logic | Same query engine |
| Relationships | Spatial labels and inferred structure | First-class graph edges |
| Time-aware queries | External utility / extra layer | Native `VERSION` queries |
| Multi-process use | Single-process friction | Auto-Server shared runtime |
| Install model | Python + external pieces | Pi install + managed runtime |

### True multi-process support

SurrealDB's embedded engine (`surrealkv://`) is single-process — only one OS process can hold the lock on a data directory.

`pi-mempalace` solves this with an **Auto-Server** pattern:
- first Pi session for a data directory starts `surreal`
- later sessions connect as clients
- each data directory maps to its own isolated server/port

That means multiple Pi sessions can collaborate on the **same project memory**, while **different projects stay isolated**.

### Vector + graph together

This package does more than nearest-neighbor recall. It can combine semantic retrieval with explicit relationships.

Example workflow:
1. semantic search finds a memory about an auth bug
2. graph queries follow related entities such as the project, tool, or concept involved
3. the agent gets both the matching memory **and** connected facts

The graph layer supports relationship types such as:
- `works_on`
- `uses`
- `depends_on`
- `related_to`
- `implements`
- `created`

For example, after finding an entity you can follow its relationships:

```typescript
import { queryEntity, queryRelationship } from "pi-mempalace";

const facts = await queryEntity("pi-mempalace");
const dependencies = await queryRelationship("depends_on", {
	subject: "pi-mempalace",
	limit: 20,
});
```

This is the practical advantage of graph-augmented retrieval: related concepts do not have to share the same room or exact phrasing to stay connected.

### Temporal versioning in the query language

Entity and edge records support time-aware queries natively:

```sql
SELECT * FROM person:jane VERSION "2026-03";
```

No separate export/import cycle, no bolt-on history layer.

### No external DBMS

`pi-mempalace` will use a configured `surreal` binary, a `surreal` already on `PATH`, or download the correct official SurrealDB binary for the current platform on first use.

No Python environment. No always-on external database service. No manual server startup.

---

## Architecture

- **Storage**: SurrealDB 3.0 with `surrealkv://` backend — embedded key-value store with vector, document, and graph capabilities in one engine
- **Process model**: `surreal start` per data directory, WebSocket clients from any number of Pi processes, port derived from data dir path (7000–7999)
- **Binary resolution**: explicit config/env override -> `PATH` -> managed per-user download in `~/.mempalace/bin/<version>/<os>-<arch>/`
- **Vector index**: HNSW (`ef_construction=150`, `m=16`, cosine distance) — cosine similarity, 384 dimensions
- **Embeddings**: `all-MiniLM-L6-v2` via `@huggingface/transformers`
- **Runtime**: Node-compatible execution with Bun fast paths through internal runtime adapters

### Memory record

| Field | Description |
|---|---|
| `text` | Raw content — no summarization, no extraction |
| `embedding` | 384-dim semantic vector |
| `wing` | Spatial division (e.g. `work`, `personal`, `project-x`) |
| `room` | Location within a wing (e.g. `tech-stack`, `decisions`) |
| `source` | Provenance (`file:src/main.ts`, `convo:2026-04-09`) |
| `timestamp` | When stored |

### Why SurrealDB 3.0

- **Single query engine** for vector search, metadata filters, and graph traversal
- **Native temporal queries** with `VERSION`
- **Local-first operation** without a separate managed database service
- **Good fit for agent memory** where text, embeddings, entities, and edges need to stay in sync

### Performance characteristics

- **Insert**: one vector + metadata write into the same storage engine
- **Query**: HNSW-backed nearest-neighbor lookup with in-engine filtering
- **No required API calls on insert or search** — embeddings are generated locally
- **No extra network hop to a separate vector service** when using local storage

---

## Use cases

### Recall architecture decisions
Store why a system was built a certain way, then retrieve it when editing related code later.

### Remember debugging sessions
Keep bug causes, failed approaches, and final fixes accessible across sessions.

### Mine a codebase once, benefit later
Import a project and let the agent navigate it through semantic recall, wings/rooms, and graph links.

### Preserve project context across multiple Pi sessions
Run several Pi sessions against the same project without losing shared memory.

---

## Features

### Core storage
`addMemory`, `addMemories` (batch), `queryMemories` (semantic with wing/room filtering), `getMemory`, `upsertMemory`, `deleteMemory`, `listMemories`, `countMemories`.

### Layered retrieval (L0–L3)
- **L0**: Identity layer — `~/.mempalace/identity.txt` with essential story
- **L1**: Essential memories on-demand for the current wing/room context
- **L2**: Wing/room filtered retrieval with configurable limits
- **L3**: Full semantic vector search across all memories

### Knowledge graph
Entity detection, persistent entity registry with confidence scores, typed edges, temporal `VERSION` queries, and palace graph traversal.

### Mining pipeline
File miner (language detection, incremental mtime-based re-mining), conversation miner (exchange-pair and paragraph chunking, room auto-detection), and wing assignment from project config.

### Agent diary
Session start/end tracking, reflection entries, milestones, daily summaries, activity statistics.

### Palace protocol
Wake-up sequence (L0 + L1), token budget management, memory attribution, query patterns: `quickRecall`, `explorePalace`, `injectContext`.

### Onboarding
First-run guided setup — user info, wing configuration, entity seeding, initial memories.

### Extension tools
Slash commands (`/remember`, `/forget`, `/recall`, `/search`, `/status`, `/palace`, `/mine`) and tool calls for direct memory management from the agent.

---

## Installation details

For local development in the package directory:

```bash
bun install
```

On first use, MemPalace resolves SurrealDB in this order:

1. `surrealBin` in `~/.mempalace/config.json` or `MEMPALACE_SURREAL_BIN`
2. `surreal` already available on `PATH`
3. automatic download of the official SurrealDB binary for the current platform into `~/.mempalace/bin/<version>/<os>-<arch>/`

Configuration at `~/.mempalace/config.json`:

```json
{
  "host": "127.0.0.1",
  "port": 7000,
  "user": "root",
  "pass": "root",
  "dataDir": "~/.mempalace",
  "surrealBin": "/absolute/path/to/surreal"
}
```

Environment overrides: `MEMPALACE_HOST`, `MEMPALACE_PORT`, `MEMPALACE_USER`, `MEMPALACE_PASS`, `MEMPALACE_DATA_DIR`, `MEMPALACE_SURREAL_BIN`.

## Usage

```typescript
import { init, addMemory, queryMemories, embed, close } from "pi-mempalace";

await init();

const embedding = await embed("The project uses TypeScript");
await addMemory({
	text: "The project uses TypeScript",
	embedding,
	wing: "work",
	room: "tech-stack",
	source: "repo-scan",
});

const results = await queryMemories(embedding, {
	wing: "work",
	limit: 5,
});

await close();
```

---

## Credits

The palace metaphor (wings, rooms, halls), verbatim storage without summarization, and the layered retrieval concept come from [milla-jovovich/mempalace](https://github.com/milla-jovovich/mempalace).

This implementation re-implements those ideas in TypeScript with SurrealDB as the storage engine, adds an Auto-Server singleton pattern for multi-process safety, and integrates with the Pi coding agent framework.

---

## Development

```bash
bun install
bun run lint
bun run fmt
bun run check
bun test
```
