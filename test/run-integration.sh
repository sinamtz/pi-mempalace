#!/bin/bash
# Integration tests for MemPalace with Auto-Server broker.
#
# The broker handles SurrealDB server lifecycle automatically:
# - First agent spawns server
# - Subsequent agents connect via WebSocket
#
# Run with: bun test test/memory.test.ts test/miner.test.ts 'test/kg/kg.test.ts' test/phase5.test.ts

set -e

cd "$(dirname "$0")/.."

echo "=== MemPalace Integration Tests ==="
echo ""

# Run tests sequentially with small delays between
for f in test/memory.test.ts test/miner.test.ts 'test/kg/kg.test.ts' test/phase5.test.ts; do
  if [ -f "$f" ]; then
    echo "Running: $f"
    bun test "$f"
    echo ""
    sleep 1
  else
    echo "Skipping: $f (not found)"
  fi
done

echo "=== All integration tests passed ==="
