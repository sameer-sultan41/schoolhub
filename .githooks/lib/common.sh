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

# Two different numbers on purpose:
#   NODE_MIN_*      the tools' true floor — cspell 10 refuses to start below Node 22.18.
#   NODE_TARGET_MAJOR  this project's actual target, read from .nvmrc (root package.json's
#                      engines.node and CI both require it too). Falls back to 24 if
#                      .nvmrc is missing or unparseable.
#
# Using only the lower number would let the hooks silently accept and run under a Node
# the project does not support — pnpm typecheck included — with no visible sign that
# happened. Using only the higher number would make the hooks warn-and-skip on most
# contributor machines right now, since Node 24 isn't universally installed yet. So:
# accept the lower floor to keep the hooks actually useful, but say so loudly (a `warn`,
# not a dim `note`) whenever the selected Node falls short of the real target.
#
# git runs hooks with the login shell's default Node — not whatever `nvm use` was run in
# the terminal. On a machine whose default is older than the tools' floor, that surfaced
# as cspell exiting non-zero with "Unsupported NodeJS version", which the hook then
# reported as "found unknown words". So: check the version first, try to upgrade through
# nvm if one is available, and skip cleanly rather than run a tool that cannot start.
NODE_MIN_MAJOR=22
NODE_MIN_MINOR=18

NODE_TARGET_MAJOR="$(sed -n 's/^v\{0,1\}\([0-9]\{1,\}\).*/\1/p' "$REPO_ROOT/.nvmrc" 2>/dev/null | head -1)"
[ -n "$NODE_TARGET_MAJOR" ] || NODE_TARGET_MAJOR=24

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
  _v_major="${_v%%.*}"
  if [ "$_v_major" -lt "$NODE_TARGET_MAJOR" ]; then
    warn "running hooks on node v$_v — this project targets >=$NODE_TARGET_MAJOR (.nvmrc), which CI enforces"
    note "typecheck/mypy results here are not guaranteed to match CI on this Node version"
  fi
  return 0
}

# Locate ruff/mypy: an active venv first (a developer who activated one is telling us
# which tool to use, pinned by apps/api/pyproject.toml's [dev] extra), then the repo's
# own .venv, then PATH. Prints the tool's path and returns 0, or prints nothing and
# returns 1 when it cannot be found at all.
#
# $VIRTUAL_ENV is checked for non-empty *before* building the path — with it unset,
# "${VIRTUAL_ENV:-}/bin/$tool" degenerates to the literal "/bin/ruff", and the
# [ -x "$candidate" ] test would happily match a real system binary living there.
python_tool() {
  tool="$1"
  if [ -n "${VIRTUAL_ENV:-}" ] && [ -x "$VIRTUAL_ENV/bin/$tool" ]; then
    printf '%s' "$VIRTUAL_ENV/bin/$tool"
    return 0
  fi
  for candidate in \
    "$REPO_ROOT/apps/api/.venv/bin/$tool" \
    "$REPO_ROOT/.venv/bin/$tool"; do
    if [ -x "$candidate" ]; then
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
