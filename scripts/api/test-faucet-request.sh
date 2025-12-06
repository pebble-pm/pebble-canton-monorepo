#!/bin/bash
# Request tokens from faucet via backend API
#
# Usage: ./scripts/api/test-faucet-request.sh <party_id> [amount] [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
PARTY_ID=""
AMOUNT=""

show_help() {
    echo "Request tokens from faucet via backend API"
    echo ""
    echo "Usage: $0 <party_id> [amount] [-h|--help]"
    echo ""
    echo "Arguments:"
    echo "  party_id    Full party ID from Canton (e.g., Alice::1220abc...)"
    echo "  amount      Optional amount to request (default: server default)"
    echo ""
    echo "Options:"
    echo "  -h, --help  Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo ""
    echo "Examples:"
    echo "  $0 'Alice::1220abcdef...'              # Request default amount"
    echo "  $0 'Alice::1220abcdef...' 500          # Request 500 tokens"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *)
            if [ -z "$PARTY_ID" ]; then
                PARTY_ID="$1"
            elif [ -z "$AMOUNT" ]; then
                AMOUNT="$1"
            else
                echo "Error: Too many arguments"
                show_help
                exit 2
            fi
            shift
            ;;
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

echo "Requesting tokens from faucet..."
echo ""

# Build JSON payload
if [ -n "$AMOUNT" ]; then
    payload="{\"partyId\": \"$PARTY_ID\", \"amount\": $AMOUNT}"
else
    payload="{\"partyId\": \"$PARTY_ID\"}"
fi

response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/faucet/request" \
    -H "Content-Type: application/json" \
    -H "X-User-Id: $PARTY_ID" \
    -d "$payload")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    echo "Faucet request successful!"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
