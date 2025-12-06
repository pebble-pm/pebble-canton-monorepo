#!/bin/bash
# Close a market for trading via backend API (admin only)
#
# Usage: ./scripts/api/test-market-close.sh <market_id> [-h|--help]
#
# Environment:
#   API_URL   - Backend API URL (default: http://localhost:3000)
#   ADMIN_KEY - Admin API key (default: dev-admin-key-change-in-prod)

set -e

API_URL="${API_URL:-http://localhost:3000}"
ADMIN_KEY="${ADMIN_KEY:-dev-admin-key-change-in-prod}"
MARKET_ID=""

show_help() {
    echo "Close a market for trading via backend API (admin only)"
    echo ""
    echo "Usage: $0 <market_id> [-h|--help]"
    echo ""
    echo "Arguments:"
    echo "  market_id   Market ID to close"
    echo ""
    echo "Options:"
    echo "  --admin-key <key>  Admin API key (default: dev-admin-key-change-in-prod)"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo "  ADMIN_KEY  Admin API key (default: dev-admin-key-change-in-prod)"
    echo ""
    echo "Example:"
    echo "  $0 abc123"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --admin-key) ADMIN_KEY="$2"; shift 2 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *) MARKET_ID="$1"; shift ;;
    esac
done

if [ -z "$MARKET_ID" ]; then
    echo "Error: market_id is required"
    show_help
    exit 2
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Closing market..."
echo ""

response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/markets/$MARKET_ID/close" \
    -H "X-Admin-Key: $ADMIN_KEY")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "Market closed successfully!"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
