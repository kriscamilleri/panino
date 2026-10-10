#!/usr/bin/env bash
# Install and build the frontend from a clean checkout. deploy.sh and CI both run
# this file, so a build that cannot succeed on the server fails the pull request
# instead of the deploy.
#
# The frontend depends on shared/ through a `file:` link. npm links that directory
# but does not install its dependencies, and Vite resolves the shared module's own
# imports (node-diff3) from shared/node_modules. That directory therefore has to be
# installed first, as every Dockerfile already does.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

echo "==> Installing the shared content-merge package's dependencies in ./shared ..."
(cd "$ROOT/shared" && npm ci --omit=dev)

echo "==> Installing NPM dependencies in ./frontend ..."
(cd "$ROOT/frontend" && npm ci)

echo "==> Running production build in ./frontend ..."
(cd "$ROOT/frontend" && NODE_ENV=production npm run build)
