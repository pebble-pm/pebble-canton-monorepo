#!/bin/bash
# Allocate a new party via backend API
#
# Usage: ./scripts/api/test-party-allocate.sh <display_name> [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
DISPLAY_NAME=""

show_help() {
    echo "Allocate a new party via backend API"
    echo ""
    echo "Usage: $0 <display_name> [-h|--help]"
    echo ""
    echo "Arguments:"
    echo "  display_name  Display name for the new party (e.g., TestUser1)"
    echo ""
    echo "Options:"
    echo "  -h, --help    Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo ""
    echo "Example:"
    echo "  $0 TestUser1"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *) DISPLAY_NAME="$1"; shift ;;
    esac
done

if [ -z "$DISPLAY_NAME" ]; then
    echo "Error: display_name is required"
    show_help
    exit 2
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Allocating party '$DISPLAY_NAME'..."
echo ""

response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/parties/allocate" \
    -H "Content-Type: application/json" \
    -d "{\"displayName\": \"$DISPLAY_NAME\"}")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "201" ]; then
    echo "Party allocated successfully!"
    echo ""
    echo "$body" | jq '.'
    echo ""
    echo "Party ID: $(echo "$body" | jq -r '.partyId')"
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
