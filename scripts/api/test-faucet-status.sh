#!/bin/bash
# Check faucet status via backend API
#
# Usage: ./scripts/api/test-faucet-status.sh [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
USER_ID="${USER_ID:-}"

show_help() {
    echo "Check faucet status via backend API"
    echo ""
    echo "Usage: $0 [-u USER_ID] [-h|--help]"
    echo ""
    echo "Options:"
    echo "  -u, --user  User/Party ID (required)"
    echo "  -h, --help  Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo "  USER_ID    User/Party ID (can also use -u flag)"
    echo ""
    echo "Example:"
    echo "  $0 -u 'Alice::1220abc...'"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -u|--user) USER_ID="$2"; shift 2 ;;
        -h|--help) show_help; exit 0 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *) echo "Error: Unexpected argument: $1"; show_help; exit 2 ;;
    esac
done

if [ -z "$USER_ID" ]; then
    echo "Error: USER_ID is required (use -u flag or set USER_ID env var)"
    show_help
    exit 2
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Checking faucet status for user: ${USER_ID:0:30}..."
echo ""

response=$(curl -s -w "\n%{http_code}" -H "X-User-Id: $USER_ID" "$API_URL/api/faucet/status")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "Faucet status:"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
