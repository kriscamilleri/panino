#!/usr/bin/env bash
# Reports environment readiness. Read-only; never mutates the repository.
set -u

cd "$(dirname "$0")/.."

echo "== Runtime =="
echo "node:   $(node -v 2>/dev/null || echo 'NOT FOUND')  (expected: v20.x — see .nvmrc)"
echo "npm:    $(npm -v 2>/dev/null || echo 'NOT FOUND')"
echo "docker: $(docker --version 2>/dev/null || echo 'NOT FOUND — required for npm run test:be')"

echo
echo "== Native bindings (backend) =="
node -e "
  try {
    require('./backend/api-service/node_modules/better-sqlite3');
    console.log('better-sqlite3: OK');
  } catch (e) {
    console.log('better-sqlite3: BROKEN — ' + String(e.message).split('\\n')[0]);
    console.log('  -> host-native backend tests may fail; use: npm run test:be');
  }
" 2>/dev/null || echo "better-sqlite3: not installed"

echo
echo "== Env files =="
for file in .env frontend/.env; do
  if [ -f "$file" ]; then
    echo "$file: present"
  else
    echo "$file: MISSING (see AGENTS.md §4)"
  fi
done

echo
echo "== Dev stack =="
if command -v docker >/dev/null 2>&1; then
  docker compose -f docker-compose.dev.yml ps 2>/dev/null || echo "(dev stack not running)"
else
  echo "(docker not installed)"
fi
