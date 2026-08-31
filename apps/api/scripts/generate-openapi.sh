#!/usr/bin/env bash
# Emit the OpenAPI schema that packages/api-client is generated from.
#
# The output is committed. CI regenerates it and fails on any diff, so a
# serializer change that alters the wire contract cannot merge while the
# TypeScript client still describes the old shape.
set -euo pipefail
cd "$(dirname "$0")/.."
DJANGO_SETTINGS_MODULE=${DJANGO_SETTINGS_MODULE:-config.settings.dev} \
DJANGO_SECRET_KEY=${DJANGO_SECRET_KEY:-schema-generation-only} \
  uv run manage.py spectacular --file openapi.yaml --validate --fail-on-warn
