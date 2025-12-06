#!/bin/bash
# List available parties from backend API
#
# Usage: ./scripts/api/test-party-list.sh [--include-system] [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
INCLUDE_SYSTEM=""

show_help() {
    echo "List available parties from backend API"
    echo ""
    echo "Usage: $0 [--include-system] [-h|--help]"
    echo ""
    echo "Options:"
    echo "  --include-system  Include system parties (PebbleAdmin, Oracle)"
    echo "  -h, --help        Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --include-system) INCLUDE_SYSTEM="true"; shift ;;
        *) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
    esac
done

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

URL="$API_URL/api/parties"
if [ "$INCLUDE_SYSTEM" = "true" ]; then
    URL="$URL?includeSystem=true"
fi

echo "Listing parties from $URL..."
echo ""

response=$(curl -s -w "\n%{http_code}" "$URL")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "Parties:"
    echo "========"
    echo ""
    echo "$body" | jq -r '.parties[]? | "  \(.displayName) \(if .isSystem then "(system)" else "" end)\n    ID: \(.id)"'
    echo ""
    echo "Total: $(echo "$body" | jq '.parties | length') parties"
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
