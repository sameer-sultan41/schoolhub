#!/usr/bin/env bash
# =============================================================================
# bootstrap-secrets.sh — create every Secrets Manager entry an environment reads.
#
# Two phases, because the env apply needs every ARN before RDS exists and the
# database URLs need the RDS address:
#
#   pre-apply   creates the generated secrets with random values, and the two
#               db/*-url secrets EMPTY (an ARN, no AWSCURRENT version; ECS
#               refuses to start a task on it, so nothing runs half-built).
#   post-apply  fills each empty db/*-url from its role password and the RDS
#               address. A URL that already has a value is left alone.
#
# It never changes a value that exists: a secret with an AWSCURRENT version is
# skipped, and its ARN printed. Rotation is rotate-secrets.sh's job.
#
# stdout carries only tfvars lines (pipe it into a terraform.tfvars fragment);
# logs go to stderr. Values are written through a 0600 temp file, never argv.
#
# Usage:
#   ./bootstrap-secrets.sh --env staging|production --phase pre-apply
#   ./bootstrap-secrets.sh --env staging|production --phase post-apply \
#       --db-host <rds address> [--app-db-host <host>] [--app-db-port 5432]
#   common: [--region R] [--profile P] [--dry-run] [-h|--help]
#
# --app-db-host defaults to --db-host and --app-db-port to 5432: v1 connects
# directly to RDS (ADR-0040). A later pooler changes only these arguments.
#
# Exit codes: 0 success, 1 refused (the reason is printed).
# =============================================================================

set -euo pipefail

ENV_NAME=""
PHASE=""
DB_HOST=""
APP_DB_HOST=""
APP_DB_PORT="5432"
DRY_RUN=0
PROFILE="${AWS_PROFILE:-}"
REGION="${AWS_REGION:-}"

DB_NAME="schoolhub"

log()  { printf '[bootstrap-secrets] %s\n' "$*" >&2; }
fail() { printf '[bootstrap-secrets] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

aws_cmd() {
  if [ -n "${PROFILE}" ]; then
    aws --profile "${PROFILE}" --region "${REGION}" "$@"
  else
    aws --region "${REGION}" "$@"
  fi
}

while [ $# -gt 0 ]; do
  case "$1" in
    --env)         ENV_NAME="${2:-}"; shift 2 ;;
    --phase)       PHASE="${2:-}"; shift 2 ;;
    --db-host)     DB_HOST="${2:-}"; shift 2 ;;
    --app-db-host) APP_DB_HOST="${2:-}"; shift 2 ;;
    --app-db-port) APP_DB_PORT="${2:-}"; shift 2 ;;
    --region)      REGION="${2:-}"; shift 2 ;;
    --profile)     PROFILE="${2:-}"; shift 2 ;;
    --dry-run)     DRY_RUN=1; shift ;;
    -h|--help)     usage 0 ;;
    *)             fail "unknown argument: $1 (try --help)" ;;
  esac
done

case "${ENV_NAME}" in
  staging|production) ;;
  *) fail "--env must be staging or production" ;;
esac
case "${PHASE}" in
  pre-apply|post-apply) ;;
  *) fail "--phase must be pre-apply or post-apply" ;;
esac
[ -n "${REGION}" ] || fail "no region: pass --region or set AWS_REGION"
if [ "${PHASE}" = "post-apply" ]; then
  [ -n "${DB_HOST}" ] || fail "--phase post-apply needs --db-host <rds address>"
  [ -n "${APP_DB_HOST}" ] || APP_DB_HOST="${DB_HOST}"
fi
[[ "${APP_DB_PORT}" =~ ^[0-9]+$ ]] || fail "--app-db-port must be a number"

command -v aws >/dev/null 2>&1 || fail "aws CLI not found"
command -v openssl >/dev/null 2>&1 || fail "openssl not found"
command -v python3 >/dev/null 2>&1 || fail "python3 not found"

PREFIX="schoolhub-${ENV_NAME}"
# name|tfvars key. The order is the order of the printed tfvars lines.
OWNED=(
  "django/secret-key|django_secret_key_arn"
  "integrations/encryption-keys|integrations_encryption_keys_arn"
  "website/machine-tokens|website_machine_tokens_arn"
  "website/machine-token|website_machine_token_arn"
  "website/revalidate-secret|website_revalidate_secret_arn"
  "db/app-password|db_role_password_arns.app"
  "db/migrator-password|db_role_password_arns.migrator"
  "db/readonly-password|db_role_password_arns.readonly"
  "db/app-url|app_database_url_arn"
  "db/migrator-url|migrator_database_url_arn"
)

umask 077
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "${TMP_DIR}"' EXIT

# Per-secret state and ARN, keyed by short name (no associative arrays: macOS
# ships bash 3.2). State is absent, deleted, empty, current or created.
var_name() { printf '%s_%s' "$1" "$(printf '%s' "$2" | tr '/-' '__')"; }
set_state() { printf -v "$(var_name STATE "$1")" '%s' "$2"; }
get_state() { local v; v="$(var_name STATE "$1")"; printf '%s' "${!v:-}"; }
set_arn() { printf -v "$(var_name ARN "$1")" '%s' "$2"; }
get_arn() { local v; v="$(var_name ARN "$1")"; printf '%s' "${!v:-}"; }

json_field() {
  python3 -c 'import json, sys; v = json.load(sys.stdin).get(sys.argv[1]); print("" if v is None else v)' "$1"
}

describe() {
  local short="$1" out err
  err="${TMP_DIR}/describe.err"
  if out="$(aws_cmd secretsmanager describe-secret --secret-id "${PREFIX}/${short}" --output json 2>"${err}")"; then
    set_arn "${short}" "$(printf '%s' "${out}" | json_field ARN)"
    if [ -n "$(printf '%s' "${out}" | json_field DeletedDate)" ]; then
      set_state "${short}" deleted
    elif printf '%s' "${out}" | python3 -c 'import json, sys; d = json.load(sys.stdin).get("VersionIdsToStages") or {}; sys.exit(0 if any("AWSCURRENT" in s for s in d.values()) else 1)'; then
      set_state "${short}" current
    else
      set_state "${short}" empty
    fi
  elif grep -q 'ResourceNotFoundException' "${err}"; then
    set_state "${short}" absent
  else
    cat "${err}" >&2
    fail "describe-secret failed for ${PREFIX}/${short}"
  fi
}

random_alnum() {
  local length="$1" value
  value="$(openssl rand -base64 192 | tr -dc 'A-Za-z0-9' | cut -c "1-${length}")"
  [ "${#value}" -eq "${length}" ] || fail "generated value is too short; refusing"
  printf '%s' "${value}"
}

# One Fernet key: 32 random bytes, URL-safe base64 (44 characters).
fernet_key() {
  openssl rand -base64 32 | tr -d '\n' | tr '+/' '-_'
}

# create_secret <short> [value]: with no value the secret is created empty.
create_secret() {
  local short="$1" out
  local args=(secretsmanager create-secret --name "${PREFIX}/${short}"
    --description "SchoolHub ${ENV_NAME}: created by infra/scripts/bootstrap-secrets.sh"
    --tags "Key=Project,Value=schoolhub" "Key=Environment,Value=${ENV_NAME}" "Key=ManagedBy,Value=bootstrap-secrets"
    --output json)
  if [ $# -ge 2 ]; then
    printf '%s' "$2" > "${TMP_DIR}/value"
    args+=(--secret-string "file://${TMP_DIR}/value")
  fi
  if [ "${DRY_RUN}" -eq 1 ]; then
    log "dry run: would create ${PREFIX}/${short}$([ $# -ge 2 ] || printf ' (empty)')"
    set_arn "${short}" "<dry run: ${PREFIX}/${short}>"
    set_state "${short}" created
    return
  fi
  out="$(aws_cmd "${args[@]}")"
  rm -f "${TMP_DIR}/value"
  set_arn "${short}" "$(printf '%s' "${out}" | json_field ARN)"
  set_state "${short}" created
  log "created ${PREFIX}/${short}$([ $# -ge 2 ] || printf ' (empty)')"
}

# put_value <short> <value>: only for a secret with no AWSCURRENT version.
put_value() {
  local short="$1"
  [ "$(get_state "${short}")" = "empty" ] || fail "refusing to overwrite ${PREFIX}/${short}"
  if [ "${DRY_RUN}" -eq 1 ]; then
    log "dry run: would fill ${PREFIX}/${short}"
    return
  fi
  printf '%s' "$2" > "${TMP_DIR}/value"
  aws_cmd secretsmanager put-secret-value --secret-id "${PREFIX}/${short}" \
    --secret-string "file://${TMP_DIR}/value" --output json >/dev/null
  rm -f "${TMP_DIR}/value"
  log "filled ${PREFIX}/${short}"
}

read_value() {
  aws_cmd secretsmanager get-secret-value --secret-id "${PREFIX}/$1" --output json | json_field SecretString
}

print_tfvars() {
  local entry short key
  for entry in "${OWNED[@]}"; do
    short="${entry%%|*}"
    key="${entry#*|}"
    case "${key}" in
      db_role_password_arns.*) continue ;;
    esac
    printf '%s = "%s"\n' "${key}" "$(get_arn "${short}")"
  done
  printf 'db_role_password_arns = {\n'
  printf '  app      = "%s"\n' "$(get_arn db/app-password)"
  printf '  migrator = "%s"\n' "$(get_arn db/migrator-password)"
  printf '  readonly = "%s"\n' "$(get_arn db/readonly-password)"
  printf '}\n'
}

# -----------------------------------------------------------------------------
# Refusals, checked before anything is written
# -----------------------------------------------------------------------------
for entry in "${OWNED[@]}"; do
  describe "${entry%%|*}"
done

for entry in "${OWNED[@]}"; do
  short="${entry%%|*}"
  if [ "$(get_state "${short}")" = "deleted" ]; then
    fail "${PREFIX}/${short} is pending deletion. Restore it (aws secretsmanager restore-secret --secret-id ${PREFIX}/${short}) or its ARN in tfvars is orphaned."
  fi
done

tokens_absent=0; token_absent=0
[ "$(get_state website/machine-tokens)" = "absent" ] && tokens_absent=1
[ "$(get_state website/machine-token)" = "absent" ] && token_absent=1
if [ "${tokens_absent}" -ne "${token_absent}" ]; then
  fail "exactly one of ${PREFIX}/website/machine-tokens and website/machine-token exists; the renderer's token must be in the API's list. Fix it by hand (infra/runbooks/rotate-website-secrets.md)."
fi

for role in app migrator; do
  if [ "$(get_state "db/${role}-url")" != "absent" ] && [ "$(get_state "db/${role}-password")" = "absent" ]; then
    fail "${PREFIX}/db/${role}-url exists but db/${role}-password does not; the URL was built from a password nobody holds."
  fi
done

# -----------------------------------------------------------------------------
# pre-apply
# -----------------------------------------------------------------------------
if [ "${PHASE}" = "pre-apply" ]; then
  for entry in "${OWNED[@]}"; do
    short="${entry%%|*}"
    case "$(get_state "${short}")" in
      created) continue ;;
      absent) ;;
      *) log "exists, unchanged: ${PREFIX}/${short}"; continue ;;
    esac
    # Assigned first, so a failed generator stops the script (set -e).
    case "${short}" in
      django/secret-key|website/revalidate-secret)
        value="$(random_alnum 64)"
        create_secret "${short}" "${value}"
        ;;
      integrations/encryption-keys)
        value="$(fernet_key)"
        create_secret "${short}" "${value}"
        ;;
      db/*-password)
        value="$(random_alnum 40)"
        create_secret "${short}" "${value}"
        ;;
      db/*-url)
        create_secret "${short}"
        ;;
      website/machine-tokens)
        # The renderer's token, and the API's list holding exactly it.
        value="$(random_alnum 64)"
        create_secret "website/machine-tokens" "${value}"
        create_secret "website/machine-token" "${value}"
        ;;
    esac
    unset value
  done
  log "not generated (external values, add them by hand): ${PREFIX}/sentry/dsn (sentry_dsn_arn), ${PREFIX}/payments/gateway (payment_gateway_secret_arn, production only)"
  print_tfvars
  exit 0
fi

# -----------------------------------------------------------------------------
# post-apply
# -----------------------------------------------------------------------------
for entry in "${OWNED[@]}"; do
  short="${entry%%|*}"
  [ "$(get_state "${short}")" != "absent" ] || fail "${PREFIX}/${short} does not exist; run --phase pre-apply first."
done

fill_url() {
  local role="$1" host="$2" port="$3" password
  if [ "$(get_state "db/${role}-url")" = "current" ]; then
    log "has a value, unchanged: ${PREFIX}/db/${role}-url"
    return
  fi
  password="$(read_value "db/${role}-password")"
  [ -n "${password}" ] || fail "${PREFIX}/db/${role}-password is empty"
  put_value "db/${role}-url" "postgres://schoolhub_${role}:${password}@${host}:${port}/${DB_NAME}?sslmode=require"
  unset password
}

fill_url app "${APP_DB_HOST}" "${APP_DB_PORT}"
# The migrator always goes straight to RDS on 5432: it runs DDL.
fill_url migrator "${DB_HOST}" 5432

print_tfvars
