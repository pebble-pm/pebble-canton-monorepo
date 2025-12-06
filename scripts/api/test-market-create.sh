#!/bin/bash
# Create a new market via backend API (admin only)
#
# Usage: ./scripts/api/test-market-create.sh --question <question> --resolution-time <time> [options] [-h|--help]
#
# Environment:
#   API_URL   - Backend API URL (default: http://localhost:3000)
#   ADMIN_KEY - Admin API key (default: dev-admin-key-change-in-prod)

set -e

API_URL="${API_URL:-http://localhost:3000}"
ADMIN_KEY="${ADMIN_KEY:-dev-admin-key-change-in-prod}"
QUESTION=""
DESCRIPTION=""
RESOLUTION_TIME=""

show_help() {
    echo "Create a new market via backend API (admin only)"
    echo ""
    echo "Usage: $0 --question <question> --resolution-time <time> [options] [-h|--help]"
    echo ""
    echo "Required:"
    echo "  --question <text>        Market question"
    echo "  --resolution-time <time> Resolution time (ISO 8601 format)"
    echo ""
    echo "Options:"
    echo "  --description <text>     Optional market description"
    echo "  --admin-key <key>        Admin API key (default: dev-admin-key-change-in-prod)"
    echo "  -h, --help               Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo "  ADMIN_KEY  Admin API key (default: dev-admin-key-change-in-prod)"
    echo ""
    echo "Examples:"
    echo "  $0 --question 'Will BTC reach 100k?' --resolution-time '2025-12-31T00:00:00Z'"
    echo "  $0 --question 'Will it rain tomorrow?' --resolution-time '2025-01-02T00:00:00Z' --description 'Weather prediction'"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --question) QUESTION="$2"; shift 2 ;;
        --description) DESCRIPTION="$2"; shift 2 ;;
        --resolution-time) RESOLUTION_TIME="$2"; shift 2 ;;
        --admin-key) ADMIN_KEY="$2"; shift 2 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *) echo "Error: Unexpected argument: $1"; show_help; exit 2 ;;
    esac
done

if [ -z "$QUESTION" ]; then
    echo "Error: --question is required"
    show_help
    exit 2
fi

if [ -z "$RESOLUTION_TIME" ]; then
    echo "Error: --resolution-time is required"
    show_help
    exit 2
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Creating market..."
echo ""

# Build JSON payload using jq for proper escaping
if [ -n "$DESCRIPTION" ]; then
    payload=$(jq -n \
        --arg q "$QUESTION" \
        --arg d "$DESCRIPTION" \
        --arg r "$RESOLUTION_TIME" \
        '{question: $q, description: $d, resolutionTime: $r}')
else
    payload=$(jq -n \
        --arg q "$QUESTION" \
        --arg r "$RESOLUTION_TIME" \
        '{question: $q, resolutionTime: $r}')
fi

response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/markets" \
    -H "Content-Type: application/json" \
    -H "X-Admin-Key: $ADMIN_KEY" \
    -d "$payload")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    echo "Market created successfully!"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
