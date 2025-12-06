#!/bin/bash
# Get admin statistics via backend API
#
# Usage: ./scripts/api/test-admin-stats.sh [-h|--help]
#
# Environment:
#   API_URL   - Backend API URL (default: http://localhost:3000)
#   ADMIN_KEY - Admin API key (default: dev-admin-key-change-in-prod)

set -e

API_URL="${API_URL:-http://localhost:3000}"
ADMIN_KEY="${ADMIN_KEY:-dev-admin-key-change-in-prod}"

show_help() {
    echo "Get admin statistics via backend API"
    echo ""
    echo "Usage: $0 [-h|--help]"
    echo ""
    echo "Options:"
    echo "  --admin-key <key>  Admin API key (default: dev-admin-key-change-in-prod)"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo "  ADMIN_KEY  Admin API key (default: dev-admin-key-change-in-prod)"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --admin-key) ADMIN_KEY="$2"; shift 2 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *) echo "Error: Unexpected argument: $1"; show_help; exit 2 ;;
    esac
done

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Getting admin statistics..."
echo ""

response=$(curl -s -w "\n%{http_code}" -H "X-Admin-Key: $ADMIN_KEY" "$API_URL/api/admin/stats")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "Admin statistics:"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
