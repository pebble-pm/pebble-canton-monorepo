#!/bin/bash
# Query Position contracts from Canton ledger directly
#
# Usage: ./scripts/canton/query-positions.sh [options]
#
# Options:
#   --party <id>    Filter by party ID
#   --market <id>   Filter by market ID
#   --side <yes|no> Filter by position side
#   -h, --help      Show help
#
# Environment:
#   JSON_API - Canton JSON API URL (default: http://localhost:7575)

set -e

JSON_API="${JSON_API:-http://localhost:7575}"
PARTY_FILTER=""
MARKET_FILTER=""
SIDE_FILTER=""

# Help text
show_help() {
    echo "Query Position contracts from Canton ledger"
    echo ""
    echo "Usage: $0 [options]"
    echo ""
    echo "Options:"
    echo "  --party <id>     Filter by party ID (partial match)"
    echo "  --market <id>    Filter by market ID (partial match)"
    echo "  --side <yes|no>  Filter by position side"
    echo "  -h, --help       Show this help message"
    echo ""
    echo "Environment:"
    echo "  JSON_API         Canton JSON API URL (default: http://localhost:7575)"
    echo ""
    echo "Examples:"
    echo "  $0                              # List all positions"
    echo "  $0 --party Alice                # Filter by party"
    echo "  $0 --market abc123 --side yes   # Filter by market and side"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        --party)
            PARTY_FILTER="$2"
            shift 2
            ;;
        --market)
            MARKET_FILTER="$2"
            shift 2
            ;;
        --side)
            SIDE_FILTER="$2"
            shift 2
            ;;
        *)
            echo "Error: Unknown option: $1"
            show_help
            exit 2
            ;;
    esac
done

# Check if jq is available
if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

# Get ledger end offset first
ledger_end=$(curl -s "$JSON_API/v2/state/ledger-end" | jq -r '.offset')
if [ -z "$ledger_end" ] || [ "$ledger_end" = "null" ]; then
    echo "Error: Failed to get ledger end offset"
    exit 1
fi

# Get PebbleAdmin party for querying
parties_response=$(curl -s "$JSON_API/v2/parties")
QUERY_PARTY=$(echo "$parties_response" | jq -r '.partyDetails[]? | select(.party | startswith("PebbleAdmin")) | .party' | head -1)
if [ -z "$QUERY_PARTY" ]; then
    echo "Error: Could not find PebbleAdmin party to query contracts"
    exit 1
fi

echo "Querying Position contracts from $JSON_API..."
echo ""

# Query active contracts
response=$(curl -s -X POST "$JSON_API/v2/state/active-contracts" \
    -H "Content-Type: application/json" \
    -d "{
        \"filter\": {
            \"filtersByParty\": {
                \"$QUERY_PARTY\": {
                    \"cumulative\": [{
                        \"identifierFilter\": {
                            \"TemplateFilter\": {
                                \"value\": {
                                    \"templateId\": \"pebble:Pebble.Position:Position\",
                                    \"includeCreatedEventBlob\": true
                                }
                            }
                        }
                    }]
                }
            }
        },
        \"activeAtOffset\": \"$ledger_end\"
    }")

# Check for errors
if echo "$response" | jq -e '.error' > /dev/null 2>&1; then
    echo "Error: $(echo "$response" | jq -r '.error')"
    exit 1
fi

# Extract and format positions
positions=$(echo "$response" | jq '[.activeContracts[]? | {
    contractId: .contractId,
    owner: .createArguments.owner,
    ownerName: (.createArguments.owner | split("::")[0]),
    marketId: .createArguments.marketId,
    side: .createArguments.side,
    quantity: .createArguments.quantity,
    lockedQuantity: .createArguments.lockedQuantity,
    avgCostBasis: .createArguments.avgCostBasis
}]')

# Apply filters
if [ -n "$PARTY_FILTER" ]; then
    positions=$(echo "$positions" | jq --arg f "$PARTY_FILTER" '[.[] | select(.owner | contains($f))]')
fi

if [ -n "$MARKET_FILTER" ]; then
    positions=$(echo "$positions" | jq --arg f "$MARKET_FILTER" '[.[] | select(.marketId | contains($f))]')
fi

if [ -n "$SIDE_FILTER" ]; then
    # Convert to uppercase for comparison
    SIDE_UPPER=$(echo "$SIDE_FILTER" | tr '[:lower:]' '[:upper:]')
    positions=$(echo "$positions" | jq --arg f "$SIDE_UPPER" '[.[] | select(.side == $f)]')
fi

count=$(echo "$positions" | jq 'length')

echo "Position Contracts:"
echo "==================="
echo ""

if [ "$count" -eq 0 ]; then
    echo "No positions found."
else
    echo "$positions" | jq -r '.[] | "  \(.ownerName) | \(.side) | Market: \(.marketId[:20])...\n    Quantity: \(.quantity) (locked: \(.lockedQuantity))\n    Avg Cost: \(.avgCostBasis)\n    Contract: \(.contractId[:30])...\n"'
fi

echo "Total: $count positions"
