#!/bin/bash
# Place a new order via backend API
#
# Usage: ./scripts/api/test-order-place.sh --party <party_id> --market <market_id> --side <side> --action <action> --price <price> --quantity <qty> [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
PARTY_ID=""
MARKET_ID=""
SIDE=""
ACTION=""
ORDER_TYPE="limit"
PRICE=""
QUANTITY=""

show_help() {
    echo "Place a new order via backend API"
    echo ""
    echo "Usage: $0 --party <party_id> --market <market_id> --side <side> --action <action> --price <price> --quantity <qty> [-h|--help]"
    echo ""
    echo "Required:"
    echo "  --party <party_id>     Full party ID from Canton"
    echo "  --market <market_id>   Market ID to trade on"
    echo "  --side <side>          Outcome side: yes or no"
    echo "  --action <action>      Order action: buy or sell"
    echo "  --price <price>        Price per share (0.01 to 0.99)"
    echo "  --quantity <qty>       Number of shares"
    echo ""
    echo "Options:"
    echo "  --type <type>          Order type: limit or market (default: limit)"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo ""
    echo "Examples:"
    echo "  $0 --party 'Alice::1220...' --market abc123 --side yes --action buy --price 0.65 --quantity 100"
    echo "  $0 --party 'Bob::1220...' --market abc123 --side no --action sell --price 0.35 --quantity 50"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --party) PARTY_ID="$2"; shift 2 ;;
        --market) MARKET_ID="$2"; shift 2 ;;
        --side) SIDE="$2"; shift 2 ;;
        --action) ACTION="$2"; shift 2 ;;
        --type) ORDER_TYPE="$2"; shift 2 ;;
        --price) PRICE="$2"; shift 2 ;;
        --quantity) QUANTITY="$2"; shift 2 ;;
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

if [ -z "$PRICE" ]; then
    echo "Error: --price is required"
    show_help
    exit 2
fi

if [ -z "$QUANTITY" ]; then
    echo "Error: --quantity is required"
    show_help
    exit 2
fi

if [ -z "$ACTION" ]; then
    echo "Error: --action is required"
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

# Normalize action
case "$ACTION" in
    buy|BUY|Buy) ACTION="buy" ;;
    sell|SELL|Sell) ACTION="sell" ;;
    *)
        echo "Error: action must be 'buy' or 'sell'"
        show_help
        exit 2
        ;;
esac

# Normalize order type
case "$ORDER_TYPE" in
    limit|LIMIT|Limit) ORDER_TYPE="limit" ;;
    market|MARKET|Market) ORDER_TYPE="market" ;;
    *)
        echo "Error: type must be 'limit' or 'market'"
        show_help
        exit 2
        ;;
esac

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Placing order..."
echo ""

# Build JSON payload using jq for proper escaping
payload=$(jq -n \
    --arg market "$MARKET_ID" \
    --arg side "$SIDE" \
    --arg action "$ACTION" \
    --arg orderType "$ORDER_TYPE" \
    --argjson price "$PRICE" \
    --argjson qty "$QUANTITY" \
    '{marketId: $market, side: $side, action: $action, orderType: $orderType, price: $price, quantity: $qty}')

response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/orders" \
    -H "Content-Type: application/json" \
    -H "X-User-Id: $PARTY_ID" \
    -d "$payload")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ] || [ "$http_code" = "201" ]; then
    echo "Order placed successfully!"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
