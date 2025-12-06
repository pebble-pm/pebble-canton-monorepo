#!/bin/bash
# List all markets via backend API
#
# Usage: ./scripts/api/test-market-list.sh [--status <status>] [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
STATUS=""

show_help() {
    echo "List all markets via backend API"
    echo ""
    echo "Usage: $0 [--status <status>] [-h|--help]"
    echo ""
    echo "Options:"
    echo "  --status <status>  Filter by market status (open, closed, resolved)"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo ""
    echo "Examples:"
    echo "  $0                    # List all markets"
    echo "  $0 --status open      # List only open markets"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --status) STATUS="$2"; shift 2 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *) echo "Error: Unexpected argument: $1"; show_help; exit 2 ;;
    esac
done

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Listing markets..."
echo ""

# Build query string
query=""
if [ -n "$STATUS" ]; then
    query="?status=$STATUS"
fi

response=$(curl -s -w "\n%{http_code}" "$API_URL/api/markets$query")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    count=$(echo "$body" | jq 'if type == "array" then length else 0 end')
    echo "Found $count market(s):"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
