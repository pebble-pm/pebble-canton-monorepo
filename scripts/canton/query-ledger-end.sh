#!/bin/bash
# Query current ledger end offset from Canton
#
# Usage: ./scripts/canton/query-ledger-end.sh [-h|--help]
#
# Environment:
#   JSON_API - Canton JSON API URL (default: http://localhost:7575)

set -e

JSON_API="${JSON_API:-http://localhost:7575}"

# Help text
show_help() {
    echo "Query current ledger end offset from Canton"
    echo ""
    echo "Usage: $0 [-h|--help]"
    echo ""
    echo "Options:"
    echo "  -h, --help    Show this help message"
    echo ""
    echo "Environment:"
    echo "  JSON_API      Canton JSON API URL (default: http://localhost:7575)"
    echo ""
    echo "This is useful for debugging to see if transactions are being processed."
}

# Parse arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help)
            show_help
            exit 0
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

# Query ledger end
echo "Querying ledger end from $JSON_API..."
echo ""

response=$(curl -s -w "\n%{http_code}" "$JSON_API/v2/state/ledger-end")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" != "200" ]; then
    echo "Error: Failed to query ledger end (HTTP $http_code)"
    echo "Response: $body"
    exit 1
fi

offset=$(echo "$body" | jq -r '.offset')

echo "Ledger State"
echo "============"
echo ""
echo "  Current Offset: $offset"
echo ""
echo "Full Response:"
echo "$body" | jq '.'
