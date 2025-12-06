#!/bin/bash
# Query parties from Canton ledger directly
#
# Usage: ./scripts/canton/query-parties.sh [-h|--help]
#
# Environment:
#   JSON_API - Canton JSON API URL (default: http://localhost:7575)

set -e

JSON_API="${JSON_API:-http://localhost:7575}"

# Help text
show_help() {
    echo "Query parties from Canton ledger"
    echo ""
    echo "Usage: $0 [-h|--help]"
    echo ""
    echo "Options:"
    echo "  -h, --help    Show this help message"
    echo ""
    echo "Environment:"
    echo "  JSON_API      Canton JSON API URL (default: http://localhost:7575)"
    echo ""
    echo "Example:"
    echo "  $0"
    echo "  JSON_API=http://canton:7575 $0"
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

# Query parties
echo "Querying parties from $JSON_API..."
echo ""

response=$(curl -s -w "\n%{http_code}" "$JSON_API/v2/parties")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" != "200" ]; then
    echo "Error: Failed to query parties (HTTP $http_code)"
    echo "Response: $body"
    exit 1
fi

# Format and display parties
echo "Parties on ledger:"
echo "=================="
echo ""

echo "$body" | jq -r '.partyDetails[]? | "  \(.party | split("::")[0]) (\(.party | split("::")[1][:8])...)"' 2>/dev/null || \
echo "$body" | jq '.'

echo ""
echo "Total: $(echo "$body" | jq '.partyDetails | length' 2>/dev/null || echo "unknown") parties"
