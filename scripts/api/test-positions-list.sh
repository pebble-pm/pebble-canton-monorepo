#!/bin/bash
# List positions via backend API
#
# Usage: ./scripts/api/test-positions-list.sh --party <party_id> [options] [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
PARTY_ID=""
MARKET_ID=""

show_help() {
    echo "List positions via backend API"
    echo ""
    echo "Usage: $0 --party <party_id> [options] [-h|--help]"
    echo ""
    echo "Required:"
    echo "  --party <party_id>     Party ID (used for authentication)"
    echo ""
    echo "Options:"
    echo "  --market <market_id>   Filter by market ID"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo ""
    echo "Examples:"
    echo "  $0 --party 'Alice::1220...'          # List positions for party"
    echo "  $0 --party 'Alice::1220...' --market abc123  # Filter by market"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --party) PARTY_ID="$2"; shift 2 ;;
        --market) MARKET_ID="$2"; shift 2 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *) echo "Error: Unexpected argument: $1"; show_help; exit 2 ;;
    esac
done

if [ -z "$PARTY_ID" ]; then
    echo "Error: --party is required"
    show_help
    exit 2
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Listing positions..."
echo ""

# Build query string
query=""
if [ -n "$MARKET_ID" ]; then
    query="?marketId=$MARKET_ID"
fi

response=$(curl -s -w "\n%{http_code}" -H "X-User-Id: $PARTY_ID" "$API_URL/api/positions$query")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    count=$(echo "$body" | jq 'if type == "array" then length else 0 end')
    echo "Found $count position(s):"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
