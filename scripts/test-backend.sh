#!/usr/bin/env bash
# Canonical backend test runner. Uses the Node 20 image so results match production
# regardless of the host Node version. Pass extra arguments through to Vitest.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE=panino-api-test
docker build -q -f backend/api-service/Dockerfile.test -t "$IMAGE" backend/api-service
docker run --rm "$IMAGE" npm test -- "$@"
