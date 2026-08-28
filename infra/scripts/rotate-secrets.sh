#!/usr/bin/env bash
# =============================================================================
# rotate-secrets.sh — rotate a platform secret in AWS Secrets Manager.
#
# Rotation policy (hosting-deployment.md §5): quarterly for provider keys,
# immediately on personnel change or suspected exposure.
#
# Not every secret is equally safe to rotate. The blast radius differs, and the
# script tells you which one you are about to touch before it does it:
#
#   django-secret-key  EVERY user is logged out. Every signed URL, password
#                      reset link and email confirmation token in flight becomes
#                      invalid. Never during admissions or results week.
#   db-app-password    Needs a coordinated PgBouncer reload, or the pooler keeps
#                      authenticating with the old verifier and every request
#                      fails. Two-phase — see below.
#   redis-auth-token   ElastiCache supports two valid tokens during a rotation,
#                      so this one is genuinely zero-downtime if done in order.
#   provider keys      Depends on the provider supporting overlapping keys.
#
# This script writes the NEW value as AWSPENDING and does NOT promote it. A
# human promotes it after confirming the application picked it up. That two-step
# is the whole point: a bad secret rotation is indistinguishable from an outage.
#
# Usage:
#   ./rotate-secrets.sh --list
#   ./rotate-secrets.sh --secret schoolhub-staging/django/secret-key --plan
#   ./rotate-secrets.sh --secret schoolhub-staging/django/secret-key --rotate
#   ./rotate-secrets.sh --secret <name> --promote
# =============================================================================

set -euo pipefail

SECRET_NAME=""
ACTION=""
LENGTH=64
PROFILE="${AWS_PROFILE:-}"
REGION="${AWS_REGION:-us-east-1}"

log()  { printf '[rotate] %s\n' "$*" >&2; }
fail() { printf '[rotate] ERROR: %s\n' "$*" >&2; exit 1; }

usage() {
  sed -n '2,36p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
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
    --secret)  SECRET_NAME="${2:-}"; shift 2 ;;
    --list)    ACTION="list"; shift ;;
    --plan)    ACTION="plan"; shift ;;
    --rotate)  ACTION="rotate"; shift ;;
    --promote) ACTION="promote"; shift ;;
    --length)  LENGTH="${2:-}"; shift 2 ;;
    --region)  REGION="${2:-}"; shift 2 ;;
    --profile) PROFILE="${2:-}"; shift 2 ;;
    -h|--help) usage 0 ;;
    *)         fail "unknown argument: $1 (try --help)" ;;
  esac
done

command -v aws >/dev/null 2>&1 || fail "aws CLI not found"
[ -n "${ACTION}" ] || usage 1

# -----------------------------------------------------------------------------
# Blast-radius classification
# -----------------------------------------------------------------------------
classify() {
  case "$1" in
    */django/secret-key)  echo "DISRUPTIVE|Logs out every user; invalidates every signed token in flight." ;;
    */db/app-*|*/db/*)    echo "COORDINATED|Requires a PgBouncer userlist reload in the same window, or every request fails auth." ;;
    */redis/auth-token)   echo "SAFE|ElastiCache accepts old and new during rotation. Rotate, deploy, then promote." ;;
    */payments/*)         echo "COORDINATED|Provider must support overlapping keys. Confirm before rotating, or in-flight payments fail." ;;
    */sentry/*)           echo "SAFE|Worst case is a gap in error reporting." ;;
    *)                    echo "UNKNOWN|Classification not recorded. Work out the blast radius before rotating." ;;
  esac
}

# -----------------------------------------------------------------------------
# list
# -----------------------------------------------------------------------------
if [ "${ACTION}" = "list" ]; then
  log "secrets in ${REGION}:"
  aws_cmd secretsmanager list-secrets \
    --query 'SecretList[?starts_with(Name, `schoolhub`)].[Name,LastRotatedDate,LastChangedDate]' \
    --output table
  exit 0
fi

[ -n "${SECRET_NAME}" ] || fail "--secret is required for ${ACTION}"

aws_cmd secretsmanager describe-secret --secret-id "${SECRET_NAME}" >/dev/null 2>&1 \
  || fail "secret not found: ${SECRET_NAME}"

classification="$(classify "${SECRET_NAME}")"
risk="${classification%%|*}"
note="${classification#*|}"

# -----------------------------------------------------------------------------
# plan
# -----------------------------------------------------------------------------
if [ "${ACTION}" = "plan" ]; then
  printf '\n'
  printf '  Secret:      %s\n' "${SECRET_NAME}"
  printf '  Region:      %s\n' "${REGION}"
  printf '  Blast radius: %s\n' "${risk}"
  printf '  Note:        %s\n' "${note}"
  printf '\n'

  aws_cmd secretsmanager describe-secret --secret-id "${SECRET_NAME}" \
    --query '{LastChanged:LastChangedDate,LastRotated:LastRotatedDate,VersionStages:VersionIdsToStages}' \
    --output json

  printf '\nSteps:\n'
  printf '  1. ./rotate-secrets.sh --secret %s --rotate    # writes AWSPENDING\n' "${SECRET_NAME}"
  case "${SECRET_NAME}" in
    */db/*)
      printf '  2. ALTER ROLE schoolhub_app PASSWORD ... on the database\n'
      printf '  3. Regenerate the PgBouncer userlist from pg_authid and reload the pooler\n'
      printf '  4. Redeploy the services so tasks pick up the new value\n'
      printf '  5. ./rotate-secrets.sh --secret %s --promote\n' "${SECRET_NAME}"
      ;;
    *)
      printf '  2. Redeploy the services so tasks pick up AWSPENDING\n'
      printf '  3. Verify the application is healthy\n'
      printf '  4. ./rotate-secrets.sh --secret %s --promote\n' "${SECRET_NAME}"
      ;;
  esac
  printf '\n'
  exit 0
fi

# -----------------------------------------------------------------------------
# rotate — generate and stage, never promote
# -----------------------------------------------------------------------------
if [ "${ACTION}" = "rotate" ]; then
  if [ "${risk}" = "DISRUPTIVE" ] || [ "${risk}" = "UNKNOWN" ]; then
    printf '\n  *** %s: %s ***\n\n' "${risk}" "${note}"
    printf '  Type the secret name to confirm: '
    read -r confirm
    [ "${confirm}" = "${SECRET_NAME}" ] || fail "confirmation did not match; nothing changed"
  fi

  # openssl, not $RANDOM. The generated value must be cryptographically random:
  # DJANGO_SECRET_KEY signs session cookies and password-reset tokens.
  command -v openssl >/dev/null 2>&1 || fail "openssl not found"
  new_value="$(openssl rand -base64 96 | tr -d '\n=+/' | cut -c "1-${LENGTH}")"
  [ "${#new_value}" -ge 32 ] || fail "generated value is too short; refusing"

  log "staging a new value as AWSPENDING (${#new_value} characters)"

  aws_cmd secretsmanager put-secret-value \
    --secret-id "${SECRET_NAME}" \
    --secret-string "${new_value}" \
    --version-stages AWSPENDING \
    --output json \
    --query 'VersionId'

  # Never echo the value. It goes to Secrets Manager and nowhere else — not to
  # stdout, not to a shell history, not to a Slack message.
  unset new_value

  log "AWSPENDING staged. AWSCURRENT is unchanged and the application is unaffected."
  log "next: redeploy so tasks read the pending value, verify health, then --promote"
  exit 0
fi

# -----------------------------------------------------------------------------
# promote — AWSPENDING becomes AWSCURRENT
# -----------------------------------------------------------------------------
if [ "${ACTION}" = "promote" ]; then
  pending_id="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_NAME}" \
    --query 'to_array(VersionIdsToStages)[0]' --output json \
    | python3 -c "import json,sys; d=json.load(sys.stdin)[0]; print(next((k for k,v in d.items() if 'AWSPENDING' in v), ''))")"

  [ -n "${pending_id}" ] || fail "no AWSPENDING version exists. Run --rotate first."

  current_id="$(aws_cmd secretsmanager describe-secret --secret-id "${SECRET_NAME}" \
    --query 'to_array(VersionIdsToStages)[0]' --output json \
    | python3 -c "import json,sys; d=json.load(sys.stdin)[0]; print(next((k for k,v in d.items() if 'AWSCURRENT' in v), ''))")"

  log "promoting ${pending_id} to AWSCURRENT (previous: ${current_id:-none})"

  aws_cmd secretsmanager update-secret-version-stage \
    --secret-id "${SECRET_NAME}" \
    --version-stage AWSCURRENT \
    --move-to-version-id "${pending_id}" \
    ${current_id:+--remove-from-version-id "${current_id}"}

  log "promoted."
  log "The previous version stays retrievable as AWSPREVIOUS — that is the rollback."
  log "Record this rotation in the change log with the reason and the operator."
  exit 0
fi

fail "unhandled action: ${ACTION}"
