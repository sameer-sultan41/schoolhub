#!/usr/bin/env bash
# =============================================================================
# seed-dev.sh — bring a local development stack up from nothing.
#
# Idempotent: safe to re-run. Does these things, in this order, because each
# depends on the one before:
#
#   1. create compose/.env from the example if it is missing, generating real
#      random local passwords (never committed, never shared)
#   2. start postgres, wait for it, and let the init scripts create the roles
#   3. generate postgres/pgbouncer/userlist.txt from the SCRAM verifiers
#      PostgreSQL actually computed — the only way the two sides agree
#   4. start pgbouncer, redis, minio and mailpit
#   5. ASSERT the tenant boundary is intact before anything writes data
#   6. run migrations and load the sample tenants
#
# Step 5 runs on every seed on purpose. The failure it catches — an app role
# that can bypass RLS — is silent, and the cheapest moment to catch it is
# before there is any data to leak.
#
# Usage:
#   ./seed-dev.sh              # full setup
#   ./seed-dev.sh --reset      # destroy volumes first (DELETES LOCAL DATA)
#   ./seed-dev.sh --check-only # run the assertions, change nothing
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"
COMPOSE_DIR="${REPO_ROOT}/compose"
ENV_FILE="${COMPOSE_DIR}/.env"
USERLIST="${REPO_ROOT}/postgres/pgbouncer/userlist.txt"

RESET=0
CHECK_ONLY=0

log()  { printf '[seed] %s\n' "$*" >&2; }
fail() { printf '[seed] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,28p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --reset)      RESET=1; shift ;;
    --check-only) CHECK_ONLY=1; shift ;;
    -h|--help)    usage 0 ;;
    *)            fail "unknown argument: $1 (try --help)" ;;
  esac
done

command -v docker >/dev/null 2>&1 || fail "docker not found"
docker compose version >/dev/null 2>&1 || fail "docker compose v2 not found"

dc() { docker compose --project-directory "${COMPOSE_DIR}" "$@"; }

random_secret() {
  # Alphanumeric only: these end up inside libpq URIs, where punctuation needs
  # percent-encoding and quietly breaks connection strings.
  openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | cut -c1-32
}

# -----------------------------------------------------------------------------
# 1. Local environment file
# -----------------------------------------------------------------------------
if [ "${CHECK_ONLY}" -eq 0 ] && [ ! -f "${ENV_FILE}" ]; then
  log "creating compose/.env with generated local passwords"
  cp "${COMPOSE_DIR}/.env.example" "${ENV_FILE}"

  for var in POSTGRES_SUPERUSER_PASSWORD APP_DB_PASSWORD MIGRATION_DB_PASSWORD \
             READONLY_DB_PASSWORD MINIO_ROOT_PASSWORD DJANGO_SECRET_KEY \
             PUBLIC_CONTENT_TOKEN REVALIDATE_SECRET; do
    value="$(random_secret)"
    # BSD and GNU sed disagree about -i; write through a temp file instead.
    awk -v k="${var}" -v v="${value}" \
      'BEGIN{FS=OFS="="} $1==k {print k "=" v; next} {print}' \
      "${ENV_FILE}" > "${ENV_FILE}.tmp"
    mv "${ENV_FILE}.tmp" "${ENV_FILE}"
  done

  chmod 600 "${ENV_FILE}"
  log "compose/.env created (git-ignored, chmod 600)"
elif [ -f "${ENV_FILE}" ]; then
  log "compose/.env already exists, leaving it alone"
fi

[ -f "${ENV_FILE}" ] || fail "compose/.env is missing and --check-only was passed"

set -a
# shellcheck source=/dev/null  # path is chosen at runtime
. "${ENV_FILE}"
set +a

POSTGRES_DB="${POSTGRES_DB:-schoolhub}"
POSTGRES_SUPERUSER="${POSTGRES_SUPERUSER:-postgres}"
APP_DB_USER="${APP_DB_USER:-schoolhub_app}"
MIGRATION_DB_USER="${MIGRATION_DB_USER:-schoolhub_migrator}"

psql_super() {
  dc exec -T postgres psql -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" "$@"
}

# -----------------------------------------------------------------------------
# 2. PostgreSQL
# -----------------------------------------------------------------------------
if [ "${CHECK_ONLY}" -eq 0 ]; then
  if [ "${RESET}" -eq 1 ]; then
    log "--reset: destroying volumes. ALL LOCAL DATA WILL BE LOST."
    printf '[seed] type "reset" to confirm: '
    read -r confirm
    [ "${confirm}" = "reset" ] || fail "not confirmed; nothing changed"
    dc down -v
    rm -f "${USERLIST}"
  fi

  log "starting postgres"
  dc up -d postgres

  log "waiting for postgres to accept connections"
  for _ in $(seq 1 60); do
    if dc exec -T postgres pg_isready -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" >/dev/null 2>&1; then
      break
    fi
    sleep 2
  done
  dc exec -T postgres pg_isready -U "${POSTGRES_SUPERUSER}" -d "${POSTGRES_DB}" >/dev/null 2>&1 \
    || fail "postgres did not become ready. Check: docker compose logs postgres"
  log "postgres is up"
fi

# -----------------------------------------------------------------------------
# 3. PgBouncer userlist, generated from what PostgreSQL actually stored
# -----------------------------------------------------------------------------
if [ "${CHECK_ONLY}" -eq 0 ]; then
  log "generating ${USERLIST} from pg_authid"

  {
    printf '; GENERATED by scripts/seed-dev.sh — do not edit, do not commit.\n'
    psql_super -Atc "
      SELECT format('\"%s\" \"%s\"', rolname, rolpassword)
      FROM pg_authid
      WHERE rolname LIKE 'schoolhub\\_%'
        AND rolpassword IS NOT NULL
        AND rolname <> '${MIGRATION_DB_USER}'"
  } > "${USERLIST}"

  # The migrator is deliberately excluded: DDL cannot run through a
  # transaction-mode pooler, so migrations connect directly on 5432.
  chmod 600 "${USERLIST}"

  entries="$(grep -c '^"' "${USERLIST}" || true)"
  [ "${entries}" -gt 0 ] || fail "no roles found in pg_authid. Did the init scripts run? docker compose logs postgres"
  log "userlist written with ${entries} role(s)"
fi

# -----------------------------------------------------------------------------
# 4. The rest of the infrastructure
# -----------------------------------------------------------------------------
if [ "${CHECK_ONLY}" -eq 0 ]; then
  log "starting pgbouncer, redis, minio, mailpit"
  dc up -d pgbouncer redis minio mailpit minio-init
fi

# -----------------------------------------------------------------------------
# 5. Tenant-boundary assertions. These run every time.
# -----------------------------------------------------------------------------
log "asserting the tenant boundary"

bypass="$(psql_super -Atc "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='${APP_DB_USER}'")"
[ "${bypass}" = "f" ] \
  || fail "${APP_DB_USER} is a superuser or has BYPASSRLS. Every RLS policy is a no-op. See postgres/init/02-app-role.sql."
log "  ok: ${APP_DB_USER} has neither superuser nor BYPASSRLS"

app_owned="$(psql_super -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner='${APP_DB_USER}'")"
[ "${app_owned}" = "0" ] \
  || fail "${APP_DB_USER} owns ${app_owned} table(s). An owner is exempt from RLS unless FORCE is set."
log "  ok: ${APP_DB_USER} owns no tables"

can_create="$(psql_super -Atc "SELECT has_schema_privilege('${APP_DB_USER}', 'public', 'CREATE')")"
[ "${can_create}" = "f" ] \
  || fail "${APP_DB_USER} has CREATE on schema public. It must have USAGE only."
log "  ok: ${APP_DB_USER} cannot create objects"

pool_mode="$(grep -E '^\s*pool_mode' "${REPO_ROOT}/postgres/pgbouncer/pgbouncer.ini" | tr -d ' ' | cut -d= -f2)"
[ "${pool_mode}" = "transaction" ] \
  || fail "pgbouncer pool_mode is '${pool_mode}', must be 'transaction'."
log "  ok: pgbouncer is in transaction pooling mode"

if [ "${CHECK_ONLY}" -eq 1 ]; then
  log "checks passed (--check-only: nothing was changed)"
  exit 0
fi

# -----------------------------------------------------------------------------
# 6. Migrations and sample data
# -----------------------------------------------------------------------------
log "running migrations as ${MIGRATION_DB_USER} (direct connection, not via the pooler)"
if ! dc run --rm --no-deps \
     -e DATABASE_URL="${MIGRATION_DATABASE_URL:-postgres://${MIGRATION_DB_USER}:${MIGRATION_DB_PASSWORD}@postgres:5432/${POSTGRES_DB}}" \
     api python manage.py migrate --noinput; then
  fail "migrations failed. If the API repo is not checked out at ../schoolhub-api-v2, set API_REPO_PATH in compose/.env."
fi

log "loading sample tenants"
dc run --rm --no-deps api python manage.py seed_dev_data \
  || log "WARNING: seed_dev_data is not available yet in the API repo — skipping sample data"

log "starting the application services"
dc up -d

cat >&2 <<EOF

[seed] ready.

  Dashboard   http://localhost:${DASHBOARD_PORT:-3000}
  Tenant site http://demo.localhost:${WEBSITE_PORT:-3001}
  API         http://localhost:${API_PORT:-8000}/api/v1
  Mailpit     http://localhost:${MAILPIT_UI_PORT:-8025}
  MinIO       http://localhost:${MINIO_CONSOLE_PORT:-9001}

  The app connects through PgBouncer on ${PGBOUNCER_PORT:-6432} as ${APP_DB_USER}.
  Use ${POSTGRES_PORT:-5432} directly only for psql, migrations and restores.

EOF
