#!/usr/bin/env bash
# Start the local Odoo used to develop the Odoo integration, creating its
# database and an API key the first time.
#
#   scripts/odoo-dev.sh                       Odoo 19 Community on http://localhost:8019
#   scripts/odoo-dev.sh enterprise [deb]      Odoo 20 Enterprise on http://localhost:8020;
#                                             pass the Enterprise .deb to build its image
#   scripts/odoo-dev.sh key [enterprise]      issue a fresh API key (they expire after 90 days)
#   scripts/odoo-dev.sh stop                  stop the containers, keeping the data
#
# Keys are written to .odoo-dev.env / .odoo-dev-ee.env (gitignored), never
# printed. Odoo's web login is admin / admin.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
COMPOSE=(docker compose -f "$ROOT/docker-compose.odoo.yml")
ENTERPRISE_IMAGE=panino-odoo-enterprise:20.0

edition=community
action=start
case "${1:-}" in
    stop)
        "${COMPOSE[@]}" --profile enterprise stop
        exit 0
        ;;
    key)
        action=key
        [ "${2:-}" = "enterprise" ] && edition=enterprise
        ;;
    enterprise)
        edition=enterprise
        deb="${2:-}"
        ;;
    ""|community) ;;
    *)
        sed -n '2,13p' "$0" >&2
        exit 1
        ;;
esac

if [ "$edition" = "enterprise" ]; then
    SERVICE=odoo-enterprise
    DB=panino_ee
    MODULES=crm,sale_management,documents,knowledge
    KEY_FILE="$ROOT/.odoo-dev-ee.env"
    HOST_URL=http://localhost:8020
    CONTAINER_URL=http://odoo-enterprise:8069
    COMPOSE+=(--profile enterprise)
else
    SERVICE=odoo
    DB=panino
    MODULES=crm,sale_management
    KEY_FILE="$ROOT/.odoo-dev.env"
    HOST_URL=http://localhost:8019
    CONTAINER_URL=http://odoo:8069
fi

if ! docker network inspect panino_default > /dev/null 2>&1; then
    echo "The dev stack's network (panino_default) is missing. Start docker-compose.dev.yml first." >&2
    exit 1
fi

if [ "$edition" = "enterprise" ] && [ -n "${deb:-}" ]; then
    deb="$(realpath "$deb")"
    case "$deb" in
        "$ROOT"/*)
            echo "Keep the Enterprise .deb outside the repository; it must never be committed." >&2
            exit 1
            ;;
    esac
    echo "==> Building $ENTERPRISE_IMAGE from $(basename "$deb")..."
    # The context is the folder holding the .deb, never the repository.
    docker build -f "$ROOT/scripts/odoo-enterprise.Dockerfile" \
        --build-arg "DEB_FILE=$(basename "$deb")" \
        -t "$ENTERPRISE_IMAGE" "$(dirname "$deb")"
fi
if [ "$edition" = "enterprise" ] && ! docker image inspect "$ENTERPRISE_IMAGE" > /dev/null 2>&1; then
    echo "No $ENTERPRISE_IMAGE image yet: run scripts/odoo-dev.sh enterprise <path to the Enterprise .deb>" >&2
    exit 1
fi

"${COMPOSE[@]}" up -d odoo-db

db_exists() {
    "${COMPOSE[@]}" exec -T odoo-db psql -U odoo -d postgres -tAc \
        "SELECT 1 FROM pg_database WHERE datname = '$DB'" | grep -q 1
}

if ! db_exists; then
    echo "==> Creating database '$DB' with $MODULES and demo data (takes a few minutes)..."
    "${COMPOSE[@]}" run --rm -T "$SERVICE" odoo -d "$DB" -i "$MODULES" --with-demo --stop-after-init
    NEW_DB=1
fi

"${COMPOSE[@]}" up -d "$SERVICE"

issue_key() {
    echo "==> Issuing an API key for admin on '$DB' (valid 90 days)..."
    local key
    key=$("${COMPOSE[@]}" run --rm -T "$SERVICE" odoo shell -d "$DB" --no-http --log-level=warn 2>/dev/null <<'PY' | sed -n 's/^PANINO_ODOO_KEY=//p'
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
# Local Odoo ($edition) for the Odoo integration (scripts/odoo-dev.sh). Do not commit.
ODOO_DEV_URL_HOST=$HOST_URL
ODOO_DEV_URL_FROM_API_CONTAINER=$CONTAINER_URL
ODOO_DEV_DATABASE=$DB
ODOO_DEV_API_KEY=$key
ODOO_DEV_KEY_EXPIRES_ON=$(date -d '+90 days' +%F)
EOF
    echo "==> Key written to $(basename "$KEY_FILE")"
}

if [ "$action" = "key" ] || [ -n "${NEW_DB:-}" ] || [ ! -f "$KEY_FILE" ]; then
    issue_key
fi

echo "==> Waiting for Odoo on $HOST_URL ..."
for _ in $(seq 1 90); do
    if curl -fsS "$HOST_URL/web/version" > /dev/null 2>&1; then
        echo "==> Odoo is up: $(curl -fsS "$HOST_URL/web/version")"
        exit 0
    fi
    sleep 2
done
echo "Odoo did not answer within three minutes; see: docker compose -f docker-compose.odoo.yml --profile enterprise logs $SERVICE" >&2
exit 1
