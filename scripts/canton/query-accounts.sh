#!/bin/bash
# Query TradingAccount contracts from Canton ledger directly
#
# Usage: ./scripts/canton/query-accounts.sh [party_id] [-h|--help]
#
# Arguments:
#   party_id  - Optional: Filter by party ID (full or partial match)
#
# Environment:
#   JSON_API - Canton JSON API URL (default: http://localhost:7575)

set -e

JSON_API="${JSON_API:-http://localhost:7575}"
PARTY_FILTER=""

# Help text
show_help() {
    echo "Query TradingAccount contracts from Canton ledger"
    echo ""
    echo "Usage: $0 [party_id] [-h|--help]"
    echo ""
    echo "Arguments:"
    echo "  party_id      Optional party ID to filter results"
    echo ""
    echo "Options:"
    echo "  -h, --help    Show this help message"
    echo ""
    echo "Environment:"
    echo "  JSON_API      Canton JSON API URL (default: http://localhost:7575)"
    echo ""
    echo "Examples:"
    echo "  $0                          # List all accounts"
    echo "  $0 Alice                    # Filter by party containing 'Alice'"
    echo "  $0 'Alice::1220abc...'      # Filter by exact party ID"
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
            PARTY_FILTER="$1"
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

# We need a party to query. Use PebbleAdmin if no filter provided.
if [ -z "$PARTY_FILTER" ]; then
    # Get all parties and use PebbleAdmin
    parties_response=$(curl -s "$JSON_API/v2/parties")
    QUERY_PARTY=$(echo "$parties_response" | jq -r '.partyDetails[]? | select(.party | startswith("PebbleAdmin")) | .party' | head -1)
    if [ -z "$QUERY_PARTY" ]; then
        echo "Error: Could not find PebbleAdmin party to query contracts"
        exit 1
    fi
else
    # Use the provided party or find matching one
    parties_response=$(curl -s "$JSON_API/v2/parties")
    QUERY_PARTY=$(echo "$parties_response" | jq -r --arg f "$PARTY_FILTER" '.partyDetails[]? | select(.party | contains($f)) | .party' | head -1)
    if [ -z "$QUERY_PARTY" ]; then
        # Try using PebbleAdmin but filter results later
        QUERY_PARTY=$(echo "$parties_response" | jq -r '.partyDetails[]? | select(.party | startswith("PebbleAdmin")) | .party' | head -1)
    fi
fi

echo "Querying TradingAccount contracts from $JSON_API..."
echo "Using party: $QUERY_PARTY"
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
                                    \"templateId\": \"pebble:Pebble.Account:TradingAccount\",
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

# Extract and format accounts
accounts=$(echo "$response" | jq '[.activeContracts[]? | {
    contractId: .contractId,
    owner: .createArguments.owner,
    ownerName: (.createArguments.owner | split("::")[0]),
    availableBalance: .createArguments.availableBalance,
    lockedBalance: .createArguments.lockedBalance
}]')

# Filter by party if provided
if [ -n "$PARTY_FILTER" ]; then
    accounts=$(echo "$accounts" | jq --arg f "$PARTY_FILTER" '[.[] | select(.owner | contains($f))]')
fi

count=$(echo "$accounts" | jq 'length')

echo "TradingAccount Contracts:"
echo "========================="
echo ""

if [ "$count" -eq 0 ]; then
    echo "No accounts found."
else
    echo "$accounts" | jq -r '.[] | "  \(.ownerName):\n    Contract ID: \(.contractId[:30])...\n    Available: \(.availableBalance)\n    Locked: \(.lockedBalance)\n"'
fi

echo "Total: $count accounts"
