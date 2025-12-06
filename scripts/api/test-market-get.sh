#!/bin/bash
# Get market details via backend API
#
# Usage: ./scripts/api/test-market-get.sh <market_id> [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
MARKET_ID=""

show_help() {
    echo "Get market details via backend API"
    echo ""
    echo "Usage: $0 <market_id> [-h|--help]"
    echo ""
    echo "Arguments:"
    echo "  market_id   Market ID to retrieve"
    echo ""
    echo "Options:"
    echo "  -h, --help  Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo ""
    echo "Example:"
    echo "  $0 abc123"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
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

echo "Getting market details..."
echo ""

response=$(curl -s -w "\n%{http_code}" "$API_URL/api/markets/$MARKET_ID")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "Market details:"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
