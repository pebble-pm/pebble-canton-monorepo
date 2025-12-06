#!/bin/bash
# Login with existing party via backend API
#
# Usage: ./scripts/api/test-party-login.sh <party_id> [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
PARTY_ID=""

show_help() {
    echo "Login with existing party via backend API"
    echo ""
    echo "Usage: $0 <party_id> [-h|--help]"
    echo ""
    echo "Arguments:"
    echo "  party_id    Full party ID from Canton (e.g., Alice::1220abc...)"
    echo ""
    echo "Options:"
    echo "  -h, --help  Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo ""
    echo "Example:"
    echo "  $0 'Alice::1220abcdef...'"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *) PARTY_ID="$1"; shift ;;
    esac
done

if [ -z "$PARTY_ID" ]; then
    echo "Error: party_id is required"
    show_help
    exit 2
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Logging in as party..."
echo ""

response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/parties/login" \
    -H "Content-Type: application/json" \
    -d "{\"partyId\": \"$PARTY_ID\"}")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    echo "Login successful!"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
