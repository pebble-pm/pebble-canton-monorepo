#!/bin/bash
# Test backend health endpoint
#
# Usage: ./scripts/api/test-health.sh [-h|--help]
#
# Environment:
#   API_URL - Backend API URL (default: http://localhost:3000)

set -e

API_URL="${API_URL:-http://localhost:3000}"

show_help() {
    echo "Test backend health endpoint"
    echo ""
    echo "Usage: $0 [-h|--help]"
    echo ""
    echo "Environment:"
    echo "  API_URL    Backend API URL (default: http://localhost:3000)"
}

while [[ $# -gt 0 ]]; do
    case $1 in
        -h|--help) show_help; exit 0 ;;
        *) echo "Error: Unknown option: $1"; show_help; exit 2 ;;
    esac
done

if ! command -v jq &> /dev/null; then
    echo "Error: jq is required but not installed"
    exit 1
fi

echo "Testing health endpoint at $API_URL..."
echo ""

response=$(curl -s -w "\n%{http_code}" "$API_URL/health")
http_code=$(echo "$response" | tail -n1)
body=$(echo "$response" | sed '$d')

if [ "$http_code" = "200" ]; then
    echo "Status: OK (HTTP $http_code)"
    echo ""
    echo "$body" | jq '.'
    exit 0
else
    echo "Status: FAILED (HTTP $http_code)"
    echo ""
    echo "$body"
    exit 1
fi
