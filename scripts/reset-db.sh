#!/bin/bash
# Reset the Pebble SQLite database
#
# Usage: ./scripts/reset-db.sh
#
# This script deletes the SQLite database files to start fresh.
# Use this when the Canton sandbox has been restarted and the
# off-chain state is stale.

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
DB_PATH="$PROJECT_ROOT/backend/pebble.db"

echo "Pebble Database Reset"
echo "====================="
echo ""

# Check if any database files exist
if [ -f "$DB_PATH" ] || [ -f "$DB_PATH-wal" ] || [ -f "$DB_PATH-shm" ]; then
    echo "Found database files:"
    ls -la "$PROJECT_ROOT/backend/pebble.db"* 2>/dev/null || true
    echo ""

    # Remove database files
    echo "Removing database files..."
    rm -f "$DB_PATH" "$DB_PATH-wal" "$DB_PATH-shm"

    echo "Database reset complete!"
else
    echo "No database files found at: $DB_PATH"
    echo "Nothing to reset."
fi
