#!/bin/bash
# Allocate parties via JSON Ledger API
#
# Usage: ./allocate-parties.sh [party_hint...]
#   If no party hints provided, allocates default Pebble parties
#
# Examples:
#   ./allocate-parties.sh                    # Allocate default parties
#   ./allocate-parties.sh TestUser1 TestUser2  # Allocate custom parties

set -e

JSON_API="${JSON_API:-http://localhost:7575}"

# Function to allocate a party
allocate_party() {
  local hint=$1
  echo -n "Allocating party '$hint'... "

  response=$(curl -s -X POST "$JSON_API/v2/parties" \
    -H "Content-Type: application/json" \
    -d "{\"partyIdHint\": \"$hint\", \"identityProviderId\": \"\"}" \
    -w "\n%{http_code}")

  http_code=$(echo "$response" | tail -n1)
  body=$(echo "$response" | sed '$d')

  if [ "$http_code" = "200" ]; then
    party_id=$(echo "$body" | jq -r '.partyDetails.party // .party // empty')
    if [ -n "$party_id" ]; then
      echo "OK"
      echo "  Party ID: $party_id"
    else
      echo "OK (response: $body)"
    fi
  else
    echo "FAILED (HTTP $http_code)"
    echo "  Response: $body"
    return 1
  fi
}

# Function to list all parties
list_parties() {
  echo "Current parties on ledger:"
  curl -s "$JSON_API/v2/parties" | jq -r '.partyDetails[]? | "  \(.party) (local: \(.isLocal))"' 2>/dev/null || \
    curl -s "$JSON_API/v2/parties" | jq '.'
}

# Check if JSON API is available
echo "Checking JSON API at $JSON_API..."
if ! curl -s -o /dev/null -w "%{http_code}" "$JSON_API/v2/parties" | grep -q "200"; then
  echo "Error: Cannot connect to JSON API at $JSON_API"
  echo "Make sure Canton sandbox is running (./scripts/start.sh)"
  exit 1
fi
echo "Connected!"
echo ""

# Wait for synchronizer connection (required for party allocation in Canton 3.4+)
echo "Waiting for synchronizer connection..."
MAX_WAIT=60
WAITED=0
while [ $WAITED -lt $MAX_WAIT ]; do
  # Check if there's at least one connected synchronizer
  SYNC_COUNT=$(curl -s "$JSON_API/v2/state/connected-synchronizers" | jq '.connectedSynchronizers | length' 2>/dev/null || echo "0")
  if [ "$SYNC_COUNT" -gt 0 ]; then
    SYNC_ID=$(curl -s "$JSON_API/v2/state/connected-synchronizers" | jq -r '.connectedSynchronizers[0].synchronizerId' 2>/dev/null)
    echo "Synchronizer connected: $SYNC_ID"
    echo ""
    break
  fi
  sleep 1
  WAITED=$((WAITED + 1))
  if [ $((WAITED % 5)) -eq 0 ]; then
    echo "  Still waiting for synchronizer... (${WAITED}s)"
  fi
done

if [ $WAITED -ge $MAX_WAIT ]; then
  echo "Error: Timeout waiting for synchronizer connection"
  echo "The sandbox may not have fully initialized."
  exit 1
fi

# If arguments provided, allocate those parties
if [ $# -gt 0 ]; then
  for party in "$@"; do
    allocate_party "$party"
  done
else
  # Allocate only system parties (PebbleAdmin and Oracle)
  # Test parties (Alice, Bob, Charlie) are created by the backend on startup
  echo "Allocating system parties..."
  echo ""

  allocate_party "PebbleAdmin"
  allocate_party "Oracle"

  echo ""
  echo "Note: Test parties (Alice, Bob, Charlie) will be created by the backend."
fi

echo ""
list_parties
