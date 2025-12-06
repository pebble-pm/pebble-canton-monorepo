#!/bin/bash
# Pebble Canton Sandbox Startup Script
#
# Usage: ./start.sh [options]
#   --rebuild    Force rebuild of DAR file before starting
#   --static     Use static time (for deterministic testing)
#   --no-parties Skip automatic party allocation
#
# Note: Party allocation happens via JSON API after sandbox starts,
# not via bootstrap script (sandbox command doesn't support --bootstrap)

set -e

# Navigate to canton directory
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CANTON_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_ROOT="$(dirname "$CANTON_DIR")"
DAR_FILE="$PROJECT_ROOT/daml/.daml/dist/pebble-0.1.0.dar"

cd "$CANTON_DIR"

# Parse arguments
REBUILD=false
STATIC_TIME=false
NO_PARTIES=false

while [[ $# -gt 0 ]]; do
  case $1 in
    --rebuild)
      REBUILD=true
      shift
      ;;
    --static)
      STATIC_TIME=true
      shift
      ;;
    --no-parties)
      NO_PARTIES=true
      shift
      ;;
    *)
      echo "Unknown option: $1"
      echo "Usage: ./start.sh [--rebuild] [--static] [--no-parties]"
      exit 1
      ;;
  esac
done

# Build DAR if needed
if [ "$REBUILD" = true ] || [ ! -f "$DAR_FILE" ]; then
  echo "Building Pebble DAR..."
  (cd "$PROJECT_ROOT/daml" && dpm build)
  echo ""
fi

# Verify DAR exists
if [ ! -f "$DAR_FILE" ]; then
  echo "Error: DAR file not found at $DAR_FILE"
  echo "Run 'cd ../daml && dpm build' first"
  exit 1
fi

echo "Starting Canton Sandbox..."
echo "  DAR: $DAR_FILE"
echo ""

# Build command
CMD="dpm sandbox"
CMD="$CMD --json-api-port 7575"
CMD="$CMD --ledger-api-port 6865"
CMD="$CMD --admin-api-port 6866"
CMD="$CMD --dar $DAR_FILE"

if [ "$STATIC_TIME" = true ]; then
  CMD="$CMD --static-time"
  echo "  Mode: Static time (for testing)"
else
  echo "  Mode: Wall-clock time"
fi

echo ""
echo "Ports:"
echo "  JSON API:   http://localhost:7575"
echo "  Ledger API: localhost:6865"
echo "  Admin API:  localhost:6866"
echo ""

# Start party allocation in background after sandbox is ready
if [ "$NO_PARTIES" = false ]; then
  echo "Party allocation will start automatically when sandbox is ready..."
  echo ""
  (
    # Wait for JSON API to be available
    echo "Waiting for JSON API..."
    for i in {1..60}; do
      if curl -s -o /dev/null -w "%{http_code}" http://localhost:7575/v2/parties 2>/dev/null | grep -q "200"; then
        echo "JSON API ready! Allocating parties..."
        "$SCRIPT_DIR/allocate-parties.sh"
        break
      fi
      sleep 2
    done
  ) &
fi

echo "Press Ctrl+C to stop"
echo "========================================"
echo ""

# Run sandbox (this blocks)
exec $CMD
