#!/usr/bin/env bash
# Shared helpers for the git hooks in this directory.
#
# Philosophy: these hooks are a fast local safety net, not the authority. CI is the
# source of truth (see AGENTS.md). So a check whose tool is genuinely not installed
# WARNS and skips rather than blocking the commit — a contributor without a Python
# venv must still be able to commit frontend work. A check whose tool *is* present
# and reports a problem always fails.

REPO_ROOT="$(git rev-parse --show-toplevel)"
export REPO_ROOT

if [ -t 2 ]; then
  C_RED=$'\033[31m'; C_YELLOW=$'\033[33m'; C_GREEN=$'\033[32m'; C_DIM=$'\033[2m'; C_OFF=$'\033[0m'
else
  C_RED=""; C_YELLOW=""; C_GREEN=""; C_DIM=""; C_OFF=""
fi

fail()  { printf '%s✗ %s%s\n' "$C_RED" "$*" "$C_OFF" >&2; }
warn()  { printf '%s! %s%s\n' "$C_YELLOW" "$*" "$C_OFF" >&2; }
ok()    { printf '%s✓ %s%s\n' "$C_GREEN" "$*" "$C_OFF" >&2; }
note()  { printf '%s  %s%s\n' "$C_DIM" "$*" "$C_OFF" >&2; }

# pnpm refuses to run under a Node older than the engines field. That check exists to
# keep CI honest, but it should not stop a local lint hook from working, so relax it
# here only. CI runs the real Node 24 and enforces the constraint properly.
export npm_config_engine_strict=false

# The toolchain's real floor: cspell 10 refuses to start below Node 22.18, and git runs
# hooks with the login shell's default Node — not whatever `nvm use` was run in the
# terminal. On a machine whose default is older, that surfaced as cspell exiting non-zero
# with "Unsupported NodeJS version", which the hook then reported as "found unknown
# words". So: check the version first, try to upgrade through nvm if one is available,
# and skip cleanly rather than run a tool that cannot start.
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=18

node_ok=""
node_checked=0

_node_version_ok() {
  # $1 = "22.23.2"
  _maj="${1%%.*}"
  _rest="${1#*.}"
  _min="${_rest%%.*}"
  [ "$_maj" -gt "$NODE_MIN_MAJOR" ] && return 0
  [ "$_maj" -eq "$NODE_MIN_MAJOR" ] && [ "$_min" -ge "$NODE_MIN_MINOR" ] && return 0
  return 1
}

ensure_node() {
  [ "$node_checked" = "1" ] && { [ -n "$node_ok" ] && return 0 || return 1; }
  node_checked=1

  if command -v node >/dev/null 2>&1 && _node_version_ok "$(node -p 'process.versions.node' 2>/dev/null || echo 0.0.0)"; then
    node_ok=1
  elif [ -s "${NVM_DIR:-$HOME/.nvm}/nvm.sh" ]; then
    # Hooks run non-interactively, so nvm is not loaded; load it and take the newest
    # installed version that clears the floor.
    . "${NVM_DIR:-$HOME/.nvm}/nvm.sh" >/dev/null 2>&1
    # No `tr` to strip the "->" and "*" markers: in a tr SET, " ->" is read as the
    # character RANGE 0x20-0x3E, which silently deletes the digits and dots too. grep -o
    # already ignores the decoration.
    for v in $(nvm ls --no-colors 2>/dev/null | grep -oE 'v[0-9]+\.[0-9]+\.[0-9]+' | sort -Vr -u); do
      if _node_version_ok "${v#v}"; then
        nvm use "$v" >/dev/null 2>&1 && node_ok=1 && break
      fi
    done
  fi

  if [ -z "$node_ok" ]; then
    warn "no Node >= ${NODE_MIN_MAJOR}.${NODE_MIN_MINOR} found — skipping JS/TS and spelling checks (CI still runs them)"
    return 1
  fi

  _v="$(node -p 'process.versions.node')"
  case "$_v" in
    24.*|2[5-9].*|[3-9][0-9].*) : ;;
    *) note "using node v$_v for hooks; the repo targets >=24, which CI enforces" ;;
  esac
  return 0
}

# Locate ruff/mypy from a venv if one exists, otherwise from PATH. Returns 1 when the
# tool cannot be found at all.
# Prints the tool's path and returns 0, or prints nothing and returns 1.
python_tool() {
  tool="$1"
  for candidate in \
    "$REPO_ROOT/apps/api/.venv/bin/$tool" \
    "$REPO_ROOT/.venv/bin/$tool" \
    "${VIRTUAL_ENV:-}/bin/$tool"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s' "$candidate"
      return 0
    fi
  done
  if command -v "$tool" >/dev/null 2>&1; then
    command -v "$tool"
    return 0
  fi
  return 1
}
