#!/usr/bin/env bash
# Start the local Odoo 19 used to develop the Odoo integration, creating its
# database and an API key the first time.
#
#   scripts/odoo-dev.sh          start (and set up on first run)
#   scripts/odoo-dev.sh key      issue a fresh API key (they expire after 90 days)
#   scripts/odoo-dev.sh stop     stop the containers, keeping the data
#
# The key is written to .odoo-dev.env (gitignored), never printed. Odoo's web
# login is admin / admin at http://localhost:8019.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/docker-compose.odoo.yml")
KEY_FILE="$ROOT/.odoo-dev.env"
DB=panino

if [ "${1:-}" = "stop" ]; then
    "${COMPOSE[@]}" stop
    exit 0
fi

if ! docker network inspect panino_default > /dev/null 2>&1; then
    echo "The dev stack's network (panino_default) is missing. Start docker-compose.dev.yml first." >&2
    exit 1
fi

"${COMPOSE[@]}" up -d odoo-db

db_exists() {
    "${COMPOSE[@]}" exec -T odoo-db psql -U odoo -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1
}

if ! db_exists; then
    echo "==> Creating database '$DB' with CRM, Sales and demo data (takes a few minutes)..."
    "${COMPOSE[@]}" run --rm -T odoo odoo -d "$DB" -i crm,sale_management --with-demo --stop-after-init
    NEW_DB=1
fi

"${COMPOSE[@]}" up -d odoo

issue_key() {
    echo "==> Issuing an API key for admin (valid 90 days)..."
    local key
    key=$("${COMPOSE[@]}" run --rm -T odoo odoo shell -d "$DB" --no-http --log-level=warn 2>/dev/null <<'PY' | sed -n 's/^PANINO_ODOO_KEY=//p'
from datetime import date, timedelta
admin = env.ref('base.user_admin')
key = env['res.users.apikeys'].with_user(admin)._generate('rpc', 'Panino dev', date.today() + timedelta(days=90))
env.cr.commit()
print('PANINO_ODOO_KEY=' + key)
PY
)
    if [ -z "$key" ]; then
        echo "Could not issue an API key." >&2
        exit 1
    fi
    umask 077
    cat > "$KEY_FILE" <<EOF
# Local Odoo 19 for the Odoo integration (scripts/odoo-dev.sh). Do not commit.
ODOO_DEV_URL_HOST=http://localhost:8019
ODOO_DEV_URL_FROM_API_CONTAINER=http://odoo:8069
ODOO_DEV_DATABASE=$DB
ODOO_DEV_API_KEY=$key
ODOO_DEV_KEY_EXPIRES_ON=$(date -d '+90 days' +%F)
EOF
    echo "==> Key written to .odoo-dev.env"
}

if [ "${1:-}" = "key" ] || [ -n "${NEW_DB:-}" ] || [ ! -f "$KEY_FILE" ]; then
    issue_key
fi

echo "==> Waiting for Odoo on http://localhost:8019 ..."
for _ in $(seq 1 60); do
    if curl -fsS http://localhost:8019/web/version > /dev/null 2>&1; then
        echo "==> Odoo is up: $(curl -fsS http://localhost:8019/web/version)"
        exit 0
    fi
    sleep 2
done
echo "Odoo did not answer within two minutes; see: docker compose -f docker-compose.odoo.yml logs odoo" >&2
exit 1
