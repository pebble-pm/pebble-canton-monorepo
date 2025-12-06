#!/bin/bash
# Query Settlement-related contracts from Canton ledger directly
#
# Usage: ./scripts/canton/query-settlements.sh [--pending|--all] [-h|--help]
#
# Options:
#   --pending   Show only pending settlements (proposals, accepted)
#   --all       Show all settlement-related contracts (default)
#   -h, --help  Show help
#
# Environment:
#   JSON_API - Canton JSON API URL (default: http://localhost:7575)

set -e

JSON_API="${JSON_API:-http://localhost:7575}"
FILTER_MODE="all"

# Help text
show_help() {
    echo "Query Settlement-related contracts from Canton ledger"
    echo ""
    echo "Usage: $0 [--pending|--all] [-h|--help]"
    echo ""
    echo "Options:"
    echo "  --pending     Show only pending settlements (proposals, accepted)"
    echo "  --all         Show all settlement contracts (default)"
    echo "  -h, --help    Show this help message"
    echo ""
    echo "Environment:"
    echo "  JSON_API      Canton JSON API URL (default: http://localhost:7575)"
    echo ""
    echo "Contract Types Queried:"
    echo "  - SettlementProposal         (created by admin)"
    echo "  - SettlementProposalAccepted (buyer accepted)"
    echo "  - Settlement                 (ready for execution)"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
            ;;
        --pending)
            FILTER_MODE="pending"
            shift
            ;;
        --all)
            FILTER_MODE="all"
            shift
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

echo "Querying Settlement contracts from $JSON_API..."
echo "Mode: $FILTER_MODE"
echo ""

# Function to query a template
query_template() {
    local template_name="$1"
    local template_id="$2"

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
                                        \"templateId\": \"$template_id\",
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

    contracts=$(echo "$response" | jq '[.activeContracts[]? | {
        contractId: .contractId,
        proposalId: .createArguments.proposalId,
        buyer: (.createArguments.buyer | split("::")[0]),
        seller: (.createArguments.seller | split("::")[0]),
        marketId: .createArguments.marketId,
        side: .createArguments.side,
        quantity: .createArguments.quantity,
        price: .createArguments.price,
        tradeType: .createArguments.tradeType,
        createdAt: .createArguments.createdAt
    }]')

    count=$(echo "$contracts" | jq 'length')

    echo "$template_name: $count"
    echo "$(printf '=%.0s' $(seq 1 $((${#template_name} + ${#count} + 2))))"

    if [ "$count" -eq 0 ]; then
        echo "  (none)"
    else
        echo "$contracts" | jq -r '.[] | "  Proposal: \(.proposalId[:20])...\n    Buyer: \(.buyer) -> Seller: \(.seller)\n    Market: \(.marketId[:20])... | \(.side) @ \(.price)\n    Quantity: \(.quantity) | Type: \(.tradeType)\n"'
    fi
    echo ""
}

# Query each settlement template
echo "Settlement Proposals (Stage 1 - admin created):"
echo "================================================"
query_template "SettlementProposal" "pebble:Pebble.Settlement:SettlementProposal"

echo "Settlement Proposals Accepted (Stage 2 - buyer accepted):"
echo "========================================================="
query_template "SettlementProposalAccepted" "pebble:Pebble.Settlement:SettlementProposalAccepted"

echo "Settlements (Stage 3 - ready for execution):"
echo "============================================="
query_template "Settlement" "pebble:Pebble.Settlement:Settlement"

# Also query MarketSettlement for resolved markets
echo "Market Settlements (post-resolution redemption):"
echo "================================================="
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
                                    \"templateId\": \"pebble:Pebble.Settlement:MarketSettlement\",
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

market_settlements=$(echo "$response" | jq '[.activeContracts[]? | {
    contractId: .contractId,
    marketId: .createArguments.marketId,
    outcome: .createArguments.outcome,
    settledAt: .createArguments.settledAt
}]')

ms_count=$(echo "$market_settlements" | jq 'length')
echo "MarketSettlement: $ms_count"

if [ "$ms_count" -eq 0 ]; then
    echo "  (none)"
else
    echo "$market_settlements" | jq -r '.[] | "  Market: \(.marketId[:30])...\n    Outcome: \(if .outcome then "YES" else "NO" end)\n    Settled: \(.settledAt)\n"'
fi
