#!/bin/bash
# Get order details via backend API
#
# Usage: ./scripts/api/test-order-get.sh <order_id> --party <party_id> [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"
ORDER_ID=""
PARTY_ID=""

show_help() {
    echo "Get order details via backend API"
    echo ""
    echo "Usage: $0 <order_id> --party <party_id> [-h|--help]"
    echo ""
    echo "Arguments:"
    echo "  order_id               Order ID to retrieve"
    echo ""
    echo "Required:"
    echo "  --party <party_id>     Party ID (for authentication)"
    echo ""
    echo "Options:"
    echo "  -h, --help             Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo ""
    echo "Example:"
    echo "  $0 order-123 --party 'Alice::1220...'"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --party) PARTY_ID="$2"; shift 2 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *) ORDER_ID="$1"; shift ;;
    esac
done

if [ -z "$ORDER_ID" ]; then
    echo "Error: order_id is required"
    show_help
    exit 2
fi

if [ -z "$PARTY_ID" ]; then
    echo "Error: --party is required"
    show_help
    exit 2
fi

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Getting order details..."
echo ""

response=$(curl -s -w "\n%{http_code}" -H "X-User-Id: $PARTY_ID" "$API_URL/api/orders/$ORDER_ID")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "Order details:"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
