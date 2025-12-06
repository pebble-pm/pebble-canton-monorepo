#!/bin/bash
# List orders via backend API
#
# Usage: ./scripts/api/test-order-list.sh --party <party_id> [options] [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
PARTY_ID=""
MARKET_ID=""
STATUS=""

show_help() {
    echo "List orders via backend API"
    echo ""
    echo "Usage: $0 --party <party_id> [options] [-h|--help]"
    echo ""
    echo "Required:"
    echo "  --party <party_id>     Party ID (for authentication)"
    echo ""
    echo "Options:"
    echo "  --market <market_id>   Filter by market ID"
    echo "  --status <status>      Filter by status (open, filled, cancelled, partial)"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo ""
    echo "Examples:"
    echo "  $0 --party 'Alice::1220...'                     # List orders for party"
    echo "  $0 --party 'Alice::1220...' --market abc123     # Filter by market"
    echo "  $0 --party 'Alice::1220...' --status open       # Filter by status"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --party) PARTY_ID="$2"; shift 2 ;;
        --market) MARKET_ID="$2"; shift 2 ;;
        --status) STATUS="$2"; shift 2 ;;
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

echo "Listing orders..."
echo ""

# Build query string
params=()
if [ -n "$MARKET_ID" ]; then
    params+=("marketId=$MARKET_ID")
fi
if [ -n "$STATUS" ]; then
    params+=("status=$STATUS")
fi

query=""
if [ ${#params[@]} -gt 0 ]; then
    query="?$(IFS='&'; echo "${params[*]}")"
fi

response=$(curl -s -w "\n%{http_code}" -H "X-User-Id: $PARTY_ID" "$API_URL/api/orders$query")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    count=$(echo "$body" | jq 'if type == "array" then length else 0 end')
    echo "Found $count order(s):"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
