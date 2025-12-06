#!/bin/bash
# Query Market contracts from Canton ledger directly
#
# Usage: ./scripts/canton/query-markets.sh [market_id] [-h|--help]
#
# Arguments:
#   market_id  - Optional: Filter by market ID (partial match)
#
# Environment:
#   JSON_API - Canton JSON API URL (default: http://localhost:7575)

set -e

JSON_API="${JSON_API:-http://localhost:7575}"
MARKET_FILTER=""

# Help text
show_help() {
    echo "Query Market contracts from Canton ledger"
    echo ""
    echo "Usage: $0 [market_id] [-h|--help]"
    echo ""
    echo "Arguments:"
    echo "  market_id     Optional market ID to filter results (partial match)"
    echo ""
    echo "Options:"
    echo "  -h, --help    Show this help message"
    echo ""
    echo "Environment:"
    echo "  JSON_API      Canton JSON API URL (default: http://localhost:7575)"
    echo ""
    echo "Examples:"
    echo "  $0                    # List all markets"
    echo "  $0 abc123             # Filter by market ID"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        -*)
            echo "Error: Unknown option: $1"
            show_help
            exit 2
            ;;
        *)
            MARKET_FILTER="$1"
            shift
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

echo "Querying Market contracts from $JSON_API..."
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
                                    \"templateId\": \"pebble:Pebble.Market:Market\",
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

# Extract and format markets
markets=$(echo "$response" | jq '[.activeContracts[]? | {
    contractId: .contractId,
    marketId: .createArguments.marketId,
    question: .createArguments.question,
    status: .createArguments.status,
    outcome: .createArguments.outcome,
    version: .createArguments.version,
    resolutionTime: .createArguments.resolutionTime,
    createdAt: .createArguments.createdAt
}]')

# Apply filter
if [ -n "$MARKET_FILTER" ]; then
    markets=$(echo "$markets" | jq --arg f "$MARKET_FILTER" '[.[] | select(.marketId | contains($f))]')
fi

count=$(echo "$markets" | jq 'length')

echo "Market Contracts:"
echo "================="
echo ""

if [ "$count" -eq 0 ]; then
    echo "No markets found."
else
    echo "$markets" | jq -r '.[] | "  Market: \(.marketId[:30])...\n    Question: \(.question[:60])...\n    Status: \(.status) | Version: \(.version)\n    Outcome: \(.outcome // "pending")\n    Resolution: \(.resolutionTime)\n    Contract: \(.contractId[:30])...\n"'
fi

echo "Total: $count markets"
