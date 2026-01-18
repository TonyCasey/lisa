#!/bin/bash
# CI Polling Script for CircleCI
# Usage: ./poll-ci.sh [BRANCH_NAME]
#
# Polls every 60 seconds, 10 minute timeout
# Exit codes: 0=success, 1=failed, 2=canceled, 3=timeout, 4=no token, 5=no pipeline
#
# Configuration:
# - Set CIRCLECI_OWNER and CIRCLECI_REPO environment variables or edit below
# - Requires ~/.circleci/cli.yml with token

# Configure these for your project (or set as environment variables)
OWNER="${CIRCLECI_OWNER:-your-org}"
REPO="${CIRCLECI_REPO:-your-repo}"

BRANCH="${1:-$(git branch --show-current)}"
TIMEOUT=600
INTERVAL=60
ELAPSED=0

# Get CircleCI token
if [ -f ~/.circleci/cli.yml ]; then
  TOKEN=$(grep token ~/.circleci/cli.yml | awk '{print $2}')
fi

if [ -z "$TOKEN" ]; then
  echo "Error: CircleCI token not found in ~/.circleci/cli.yml"
  exit 4
fi

# Get latest pipeline for branch
PIPELINE_ID=$(curl -s -H "Circle-Token: $TOKEN" \
  "https://circleci.com/api/v2/project/gh/${OWNER}/${REPO}/pipeline?branch=${BRANCH}" \
  | jq -r '.items[0].id')

if [ -z "$PIPELINE_ID" ] || [ "$PIPELINE_ID" == "null" ]; then
  echo "Error: No pipeline found for branch: $BRANCH"
  echo "Project: ${OWNER}/${REPO}"
  exit 5
fi

echo "Branch: $BRANCH"
echo "Project: ${OWNER}/${REPO}"
echo "Pipeline: $PIPELINE_ID"
echo "Timeout: ${TIMEOUT}s, Interval: ${INTERVAL}s"
echo "---"

while [ $ELAPSED -lt $TIMEOUT ]; do
  STATUS=$(curl -s -H "Circle-Token: $TOKEN" \
    "https://circleci.com/api/v2/pipeline/${PIPELINE_ID}/workflow" \
    | jq -r '.items[0].status')

  echo "[$(date '+%H:%M:%S')] Status: $STATUS (${ELAPSED}s elapsed)"

  if [[ "$STATUS" == "success" ]]; then
    echo "CI PASSED!"
    exit 0
  elif [[ "$STATUS" == "failed" ]]; then
    echo "CI FAILED!"
    exit 1
  elif [[ "$STATUS" == "canceled" ]]; then
    echo "CI CANCELED!"
    exit 2
  fi

  sleep $INTERVAL
  ELAPSED=$((ELAPSED + INTERVAL))
done

echo "TIMEOUT: CI did not complete within ${TIMEOUT}s"
exit 3
