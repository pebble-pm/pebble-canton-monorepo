#!/bin/bash
# Resolve a market with outcome via backend API (admin/oracle only)
#
# Usage: ./scripts/api/test-market-resolve.sh <market_id> <outcome> [-h|--help]
#
# Environment:
#   API_URL   - Backend API URL (default: http://localhost:3000)
#   ADMIN_KEY - Admin API key (default: dev-admin-key-change-in-prod)

set -e

API_URL="${API_URL:-http://localhost:3000}"
ADMIN_KEY="${ADMIN_KEY:-dev-admin-key-change-in-prod}"
MARKET_ID=""
OUTCOME=""

show_help() {
    echo "Resolve a market with outcome via backend API (admin/oracle only)"
    echo ""
    echo "Usage: $0 <market_id> <outcome> [-h|--help]"
    echo ""
    echo "Arguments:"
    echo "  market_id   Market ID to resolve"
    echo "  outcome     Resolution outcome: yes, no, true, false"
    echo ""
    echo "Options:"
    echo "  --admin-key <key>  Admin API key (default: dev-admin-key-change-in-prod)"
    echo "  -h, --help         Show this help message"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
    echo "  ADMIN_KEY  Admin API key (default: dev-admin-key-change-in-prod)"
    echo ""
    echo "Examples:"
    echo "  $0 abc123 yes"
    echo "  $0 abc123 no"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        --admin-key) ADMIN_KEY="$2"; shift 2 ;;
        -*) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
        *)
            if [ -z "$MARKET_ID" ]; then
                MARKET_ID="$1"
            elif [ -z "$OUTCOME" ]; then
                OUTCOME="$1"
            else
                echo "Error: Too many arguments"
                show_help
                exit 2
            fi
            shift
            ;;
    esac
done

if [ -z "$MARKET_ID" ]; then
    echo "Error: market_id is required"
    show_help
    exit 2
fi

if [ -z "$OUTCOME" ]; then
    echo "Error: outcome is required"
    show_help
    exit 2
fi

# Normalize outcome to boolean
case "$OUTCOME" in
    yes|true|YES|TRUE|Yes|True|1)
        outcome_bool=true
        ;;
    no|false|NO|FALSE|No|False|0)
        outcome_bool=false
        ;;
    *)
        echo "Error: outcome must be yes/no or true/false"
        show_help
        exit 2
        ;;
esac

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Resolving market..."
echo ""

response=$(curl -s -w "\n%{http_code}" -X POST "$API_URL/api/markets/$MARKET_ID/resolve" \
    -H "Content-Type: application/json" \
    -H "X-Admin-Key: $ADMIN_KEY" \
    -d "{\"outcome\": $outcome_bool}")

http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "Market resolved successfully!"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Error: HTTP $http_code"
    echo "$body" | jq '.' 2>/dev/null || echo "$body"
    exit 1
fi
