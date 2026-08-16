#!/usr/bin/env bash
# Canonical backend test runner. Uses the Node 24 image so results match production
# regardless of the host Node version. Pass extra arguments through to Vitest.
set -euo pipefail

cd "$(dirname "$0")/.."

IMAGE=panino-api-test
if [[ "${SKIP_IMAGE_BUILD:-0}" != "1" ]]; then
  docker build -q -f backend/api-service/Dockerfile.test -t "$IMAGE" backend/api-service
fi

# The image's build context is backend/api-service, so repo-level scripts/ is not baked in.
# tests/unit/stream-database-backup.test.js imports the producer by a path relative to the
# repo root (../../../../scripts/...). Inside the container WORKDIR is /app, so that path
# resolves to /scripts — mount it read-only there so the import means the same thing in the
# container as it does on the host. Keeps the build context narrow (DX-01 Phase 1).
docker run --rm -v "$PWD/scripts:/scripts:ro" "$IMAGE" npm test -- "$@"
