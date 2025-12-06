#!/bin/bash
# Redeem a position after market resolution via backend API
#
# Usage: ./scripts/api/test-position-redeem.sh --party <party_id> --market <market_id> --side <side> [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
PARTY_ID=""
MARKET_ID=""
SIDE=""

show_help() {
    echo "Redeem a position after market resolution via backend API"
    echo ""
    echo "Usage: $0 --party <party_id> --market <market_id> --side <side> [-h|--help]"
    echo ""
    echo "Required:"
    echo "  --party <party_id>     Full party ID from Canton"
    echo "  --market <market_id>   Market ID"
    echo "  --side <side>          Position side: yes or no"
    echo ""
    echo "Options:"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo ""
    echo "Example:"
    echo "  $0 --party 'Alice::1220...' --market abc123 --side yes"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --party) PARTY_ID="$2"; shift 2 ;;
        --market) MARKET_ID="$2"; shift 2 ;;
        --side) SIDE="$2"; shift 2 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *) echo "Error: Unexpected argument: $1"; show_help; exit 2 ;;
    esac
done

if [ -z "$PARTY_ID" ]; then
    echo "Error: --party is required"
    show_help
    exit 2
fi

if [ -z "$MARKET_ID" ]; then
    echo "Error: --market is required"
    show_help
    exit 2
fi

if [ -z "$SIDE" ]; then
    echo "Error: --side is required"
    show_help
    exit 2
fi

# Normalize side
case "$SIDE" in
    yes|YES|Yes) SIDE="yes" ;;
    no|NO|No) SIDE="no" ;;
    *)
        echo "Error: side must be 'yes' or 'no'"
        show_help
        exit 2
        ;;
esac

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Redeeming position..."
echo ""

# Build JSON payload
payload=$(jq -n \
    --arg party "$PARTY_ID" \
    --arg market "$MARKET_ID" \
    --arg side "$SIDE" \
    '{partyId: $party, marketId: $market, side: $side}')

response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/positions/redeem" \
    -H "Content-Type: application/json" \
    -H "X-User-Id: $PARTY_ID" \
    -d "$payload")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "Position redeemed successfully!"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
