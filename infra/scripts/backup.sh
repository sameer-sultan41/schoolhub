#!/usr/bin/env bash
# =============================================================================
# backup.sh — logical backup of the SchoolHub database.
#
# This is the SECONDARY backup path. The primary one is continuous WAL
# archiving plus automated snapshots, managed by the provider, giving PITR to
# any moment in the retention window (database-architecture.md §6). That is what
# recovers production.
#
# A logical dump is what you want when PITR cannot help:
#   * extracting one tenant's rows into a scratch database
#   * seeding staging from an anonymized production schema
#   * moving between providers, or between major PostgreSQL versions
#   * a copy that lives outside the provider, in case the provider is the outage
#
# Connects DIRECTLY to PostgreSQL, never through PgBouncer: pg_dump holds a
# session-scoped snapshot and would be broken by transaction pooling.
#
# Usage:
#   ./backup.sh                          # dump to ./backups, using $DATABASE_URL
#   ./backup.sh --upload s3://bucket/pg  # dump and upload, then delete locally
#   ./backup.sh --schema-only            # structure only, no tenant data
#
# Spec: docs/02-architecture/hosting-deployment.md §7
# =============================================================================

set -euo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

BACKUP_DIR="${BACKUP_DIR:-${REPO_ROOT}/backups}"
UPLOAD_TARGET=""
SCHEMA_ONLY=0
KEEP_LOCAL=0
RETAIN_LOCAL_DAYS="${RETAIN_LOCAL_DAYS:-7}"

log()  { printf '[backup] %s\n' "$*" >&2; }
fail() { printf '[backup] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --upload)      UPLOAD_TARGET="${2:-}"; shift 2 ;;
    --schema-only) SCHEMA_ONLY=1; shift ;;
    --keep-local)  KEEP_LOCAL=1; shift ;;
    --dir)         BACKUP_DIR="${2:-}"; shift 2 ;;
    -h|--help)     usage 0 ;;
    *)             fail "unknown argument: $1 (try --help)" ;;
  esac
done

# -----------------------------------------------------------------------------
# Preconditions
# -----------------------------------------------------------------------------
command -v pg_dump >/dev/null 2>&1 || fail "pg_dump not found. Install the PostgreSQL 18 client."
[ -n "${DATABASE_URL:-}" ] || fail "DATABASE_URL is not set. Export the direct (5432) URL, not the PgBouncer one."

# A dump through the pooler produces a corrupt or partial file, and it does so
# without an obvious error. Refuse rather than discover it during a restore.
case "${DATABASE_URL}" in
  *:6432/*) fail "DATABASE_URL points at PgBouncer (6432). pg_dump needs a direct connection to PostgreSQL on 5432." ;;
esac

# Server and client majors must match or pg_dump refuses / produces a file the
# target cannot read.
server_version="$(psql "${DATABASE_URL}" -Atc 'SHOW server_version_num' 2>/dev/null)" \
  || fail "cannot connect to the database with DATABASE_URL"
if [ "${server_version}" -lt 180000 ]; then
  fail "server is not PostgreSQL 18 (server_version_num=${server_version}). Check you are pointed at the right instance."
fi

client_major="$(pg_dump --version | grep -oE '[0-9]+' | head -1)"
[ "${client_major}" -ge 18 ] || fail "pg_dump is version ${client_major}; PostgreSQL 18 requires an 18+ client."

mkdir -p "${BACKUP_DIR}"

timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
label="$([ "${SCHEMA_ONLY}" -eq 1 ] && echo schema || echo full)"
dump_file="${BACKUP_DIR}/schoolhub-${label}-${timestamp}.dump"

# -----------------------------------------------------------------------------
# Dump
# -----------------------------------------------------------------------------
# Custom format (-Fc): compressed, and restorable selectively with pg_restore
# -t / -n, which is what single-tenant recovery needs.
#
# --no-owner / --no-privileges: ownership and grants are recreated by
# postgres/init/02-app-role.sql and by the Django migrations. Restoring them
# from a dump is how an app role accidentally ends up owning tables — and an
# owner is exempt from RLS unless FORCE is set. Do not remove these flags.
dump_args=(
  --format=custom
  --compress=9
  --no-owner
  --no-privileges
  --verbose
  --file="${dump_file}"
)

if [ "${SCHEMA_ONLY}" -eq 1 ]; then
  dump_args+=(--schema-only)
fi

log "dumping ${label} backup to ${dump_file}"
start="$(date -u +%s)"

if ! pg_dump "${DATABASE_URL}" "${dump_args[@]}"; then
  rm -f "${dump_file}"
  fail "pg_dump failed. Partial file removed so it cannot be mistaken for a good backup."
fi

elapsed=$(( $(date -u +%s) - start ))
size="$(du -h "${dump_file}" | cut -f1)"
log "dump complete in ${elapsed}s, ${size}"

# -----------------------------------------------------------------------------
# Verify
# -----------------------------------------------------------------------------
# An unverified backup is not a backup. This is not a restore test — that is
# scripts/restore.sh and the quarterly drill — but it proves the file is a
# readable archive with a plausible number of objects in it.
log "verifying the archive is readable"
object_count="$(pg_restore --list "${dump_file}" | grep -cv '^;' || true)"
[ "${object_count}" -gt 0 ] || fail "the dump contains no objects. Something is very wrong."
log "archive lists ${object_count} objects"

checksum="$(sha256sum "${dump_file}" | cut -d' ' -f1)"
printf '%s  %s\n' "${checksum}" "$(basename "${dump_file}")" > "${dump_file}.sha256"
log "sha256: ${checksum}"

# -----------------------------------------------------------------------------
# Upload
# -----------------------------------------------------------------------------
if [ -n "${UPLOAD_TARGET}" ]; then
  command -v aws >/dev/null 2>&1 || fail "aws CLI not found, cannot upload"

  remote="${UPLOAD_TARGET%/}/$(date -u +%Y/%m)/$(basename "${dump_file}")"
  log "uploading to ${remote}"

  # SSE-KMS is enforced by the bucket policy; passing it explicitly means a
  # policy change turns into a failed upload rather than a silently
  # unencrypted object.
  aws s3 cp "${dump_file}" "${remote}" --sse aws:kms
  aws s3 cp "${dump_file}.sha256" "${remote}.sha256" --sse aws:kms

  # Read it back and compare. An upload that reported success and stored
  # nothing useful is the exact failure a DR drill discovers too late.
  log "verifying the uploaded object"
  remote_size="$(aws s3api head-object \
    --bucket "$(echo "${remote}" | cut -d/ -f3)" \
    --key "$(echo "${remote}" | cut -d/ -f4-)" \
    --query ContentLength --output text)"
  local_size="$(wc -c < "${dump_file}" | tr -d ' ')"
  [ "${remote_size}" = "${local_size}" ] || fail "uploaded size ${remote_size} != local size ${local_size}"
  log "upload verified"

  if [ "${KEEP_LOCAL}" -eq 0 ]; then
    rm -f "${dump_file}" "${dump_file}.sha256"
    log "local copy removed (pass --keep-local to keep it)"
  fi
fi

# -----------------------------------------------------------------------------
# Prune old local dumps
# -----------------------------------------------------------------------------
if [ -d "${BACKUP_DIR}" ] && [ "${RETAIN_LOCAL_DAYS}" -gt 0 ]; then
  pruned="$(find "${BACKUP_DIR}" -name 'schoolhub-*.dump*' -mtime "+${RETAIN_LOCAL_DAYS}" -print -delete | wc -l | tr -d ' ')"
  [ "${pruned}" -eq 0 ] || log "pruned ${pruned} local dump(s) older than ${RETAIN_LOCAL_DAYS} days"
fi

log "done"
