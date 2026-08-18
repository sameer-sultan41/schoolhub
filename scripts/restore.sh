#!/usr/bin/env bash
# =============================================================================
# restore.sh — restore a logical dump into a target database.
#
# READ THIS BEFORE RUNNING IT AGAINST ANYTHING THAT MATTERS.
#
# This script restores INTO A SCRATCH DATABASE by default and refuses to touch
# anything whose name looks like production unless you pass --i-understand.
# That is not paranoia: the normal recovery path for production is PITR to a
# NEW instance, followed by copying the affected rows back — never an in-place
# restore over a live database (database-architecture.md §6).
#
# After any restore, the app role's grants and the RLS policies must be correct,
# because a dump taken with --no-owner/--no-privileges carries neither. This
# script re-runs the role bootstrap and then ASSERTS the tenant boundary before
# reporting success. A restored database that has lost RLS is worse than no
# restore at all.
#
# Usage:
#   ./restore.sh --file backups/schoolhub-full-*.dump --target postgres://.../scratch
#   ./restore.sh --file <dump> --target <url> --tenant <uuid>   # one tenant's rows
#
# Spec: schoolhub-srd/docs/02-architecture/database-architecture.md §6
#       runbooks/backup-restore.md
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

DUMP_FILE=""
TARGET_URL=""
TENANT_ID=""
JOBS="${JOBS:-4}"
CONFIRMED=0
SKIP_ROLE_BOOTSTRAP=0

log()  { printf '[restore] %s\n' "$*" >&2; }
fail() { printf '[restore] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --file)             DUMP_FILE="${2:-}"; shift 2 ;;
    --target)           TARGET_URL="${2:-}"; shift 2 ;;
    --tenant)           TENANT_ID="${2:-}"; shift 2 ;;
    --jobs)             JOBS="${2:-}"; shift 2 ;;
    --i-understand)     CONFIRMED=1; shift ;;
    --skip-role-bootstrap) SKIP_ROLE_BOOTSTRAP=1; shift ;;
    -h|--help)          usage 0 ;;
    *)                  fail "unknown argument: $1 (try --help)" ;;
  esac
done

# -----------------------------------------------------------------------------
# Preconditions
# -----------------------------------------------------------------------------
[ -n "${DUMP_FILE}" ]  || fail "--file is required"
[ -n "${TARGET_URL}" ] || fail "--target is required"
[ -f "${DUMP_FILE}" ]  || fail "dump file not found: ${DUMP_FILE}"

command -v pg_restore >/dev/null 2>&1 || fail "pg_restore not found. Install the PostgreSQL 18 client."

case "${TARGET_URL}" in
  *:6432/*) fail "--target points at PgBouncer (6432). A restore is DDL and needs a direct connection on 5432." ;;
esac

# Refuse anything that smells like production unless explicitly confirmed.
if [ "${CONFIRMED}" -eq 0 ]; then
  case "${TARGET_URL}" in
    *prod*|*production*|*live*)
      fail "the target looks like production. Restore to a scratch instance and copy rows across instead. If you are certain, re-run with --i-understand."
      ;;
  esac
fi

# Verify the checksum if the sidecar file is present. A dump that was truncated
# in transit restores partially and looks plausible.
if [ -f "${DUMP_FILE}.sha256" ]; then
  log "verifying checksum"
  (cd "$(dirname "${DUMP_FILE}")" && sha256sum -c "$(basename "${DUMP_FILE}").sha256") \
    || fail "checksum mismatch. This dump is damaged; do not restore it."
  log "checksum OK"
else
  log "WARNING: no .sha256 sidecar; cannot verify the dump is intact"
fi

log "listing archive contents"
object_count="$(pg_restore --list "${DUMP_FILE}" | grep -cv '^;' || true)"
[ "${object_count}" -gt 0 ] || fail "the archive contains no objects"
log "archive lists ${object_count} objects"

# Confirm the target is reachable and is PostgreSQL 18.
target_version="$(psql "${TARGET_URL}" -Atc 'SHOW server_version_num')" \
  || fail "cannot connect to the target"
[ "${target_version}" -ge 180000 ] || fail "target is not PostgreSQL 18 (server_version_num=${target_version})"

target_db="$(psql "${TARGET_URL}" -Atc 'SELECT current_database()')"
existing_tables="$(psql "${TARGET_URL}" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"

log "target database: ${target_db} (${existing_tables} existing tables in public)"

if [ "${existing_tables}" -gt 0 ] && [ "${CONFIRMED}" -eq 0 ]; then
  fail "the target already contains ${existing_tables} tables. Restore into an empty database, or re-run with --i-understand to overwrite."
fi

# -----------------------------------------------------------------------------
# Restore
# -----------------------------------------------------------------------------
start="$(date -u +%s)"

# --no-owner / --no-privileges again on the way in: ownership and grants come
# from the bootstrap SQL below, not from the dump. This is what keeps the app
# role from ending up owning tables after a restore.
restore_args=(
  --dbname="${TARGET_URL}"
  --no-owner
  --no-privileges
  --jobs="${JOBS}"
  --verbose
)

if [ "${CONFIRMED}" -eq 1 ] && [ "${existing_tables}" -gt 0 ]; then
  restore_args+=(--clean --if-exists)
fi

log "restoring with ${JOBS} parallel jobs — this is the long step"

# pg_restore exits non-zero on warnings that are often benign (a missing role,
# an extension already present). Capture the output and judge it rather than
# failing blindly or ignoring it blindly.
restore_log="$(mktemp)"
set +e
pg_restore "${restore_args[@]}" "${DUMP_FILE}" >"${restore_log}" 2>&1
restore_code=$?
set -e

error_count="$(grep -c '^pg_restore: error' "${restore_log}" || true)"

if [ "${restore_code}" -ne 0 ] && [ "${error_count}" -gt 0 ]; then
  log "pg_restore reported ${error_count} error(s):"
  grep '^pg_restore: error' "${restore_log}" | head -20 >&2
  rm -f "${restore_log}"
  fail "restore failed"
fi

rm -f "${restore_log}"
elapsed=$(( $(date -u +%s) - start ))
log "restore complete in ${elapsed}s"

# -----------------------------------------------------------------------------
# Re-establish roles and grants
# -----------------------------------------------------------------------------
if [ "${SKIP_ROLE_BOOTSTRAP}" -eq 0 ]; then
  log "re-applying role grants from postgres/init/02-app-role.sql"
  : "${APP_DB_PASSWORD:?APP_DB_PASSWORD must be set to re-apply grants (or pass --skip-role-bootstrap)}"
  : "${MIGRATION_DB_PASSWORD:?MIGRATION_DB_PASSWORD must be set}"
  : "${READONLY_DB_PASSWORD:?READONLY_DB_PASSWORD must be set}"

  psql "${TARGET_URL}" -v ON_ERROR_STOP=1 \
    -v app_user="${APP_DB_USER:-schoolhub_app}"             -v app_password="${APP_DB_PASSWORD}" \
    -v migration_user="${MIGRATION_DB_USER:-schoolhub_migrator}" -v migration_password="${MIGRATION_DB_PASSWORD}" \
    -v readonly_user="${READONLY_DB_USER:-schoolhub_readonly}"   -v readonly_password="${READONLY_DB_PASSWORD}" \
    -f "${REPO_ROOT}/postgres/init/02-app-role.sql"
fi

# -----------------------------------------------------------------------------
# Verification. The restore is not finished until these pass.
# -----------------------------------------------------------------------------
log "verifying the restored database"

table_count="$(psql "${TARGET_URL}" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public'")"
[ "${table_count}" -gt 0 ] || fail "no tables in public after restore"
log "tables restored: ${table_count}"

# Every table carrying tenant_id must have RLS enabled. A restore that lost a
# policy is a cross-tenant leak waiting for the first request.
unprotected="$(psql "${TARGET_URL}" -Atc "
  SELECT count(*)
  FROM pg_tables t
  JOIN pg_class c ON c.relname = t.tablename
  WHERE t.schemaname = 'public'
    AND EXISTS (
      SELECT 1 FROM information_schema.columns col
      WHERE col.table_schema = 'public'
        AND col.table_name = t.tablename
        AND col.column_name = 'tenant_id'
    )
    AND NOT c.relrowsecurity
")"

if [ "${unprotected}" != "0" ]; then
  psql "${TARGET_URL}" -c "
    SELECT t.tablename
    FROM pg_tables t
    JOIN pg_class c ON c.relname = t.tablename
    WHERE t.schemaname='public' AND NOT c.relrowsecurity
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema='public' AND col.table_name=t.tablename
                    AND col.column_name='tenant_id')"
  fail "${unprotected} tenant table(s) have tenant_id but no RLS. Run the Django migrations against this database before letting anything connect to it."
fi
log "every tenant-scoped table has RLS enabled"

# The app role must still be RLS-bound after the restore.
bypass="$(psql "${TARGET_URL}" -Atc "SELECT rolsuper OR rolbypassrls FROM pg_roles WHERE rolname='${APP_DB_USER:-schoolhub_app}'")"
[ "${bypass}" = "f" ] || fail "the application role has BYPASSRLS or superuser after restore. Do not point the application at this database."
log "application role is RLS-bound"

# Ownership must sit with the migrator, not the app role.
app_owned="$(psql "${TARGET_URL}" -Atc "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tableowner='${APP_DB_USER:-schoolhub_app}'")"
[ "${app_owned}" = "0" ] || fail "the application role owns ${app_owned} table(s). An owner bypasses RLS unless FORCE is set."
log "application role owns no tables"

# -----------------------------------------------------------------------------
# Single-tenant extraction
# -----------------------------------------------------------------------------
if [ -n "${TENANT_ID}" ]; then
  log "counting rows for tenant ${TENANT_ID}"
  psql "${TARGET_URL}" -c "
    SELECT c.relname AS table_name,
           (xpath('/row/cnt/text()',
             query_to_xml(format('SELECT count(*) AS cnt FROM %I WHERE tenant_id = %L', c.relname, '${TENANT_ID}'),
                          false, true, '')))[1]::text::bigint AS rows
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relkind = 'r'
      AND EXISTS (SELECT 1 FROM information_schema.columns col
                  WHERE col.table_schema='public' AND col.table_name=c.relname
                    AND col.column_name='tenant_id')
    ORDER BY 2 DESC NULLS LAST
    LIMIT 40"
  log "review these counts against the incident report before copying anything back to production"
fi

log "restore verified. Record the elapsed time (${elapsed}s) in the drill log — it is the measured RTO."
