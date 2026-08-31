# syntax=docker/dockerfile:1

# Was previously ignored: compose passes this as a build arg but the image never
# declared it, so every service silently built from the hardcoded default below
# regardless of what infra/compose/.env.example set.
ARG PYTHON_IMAGE=python:3.14-slim

FROM ${PYTHON_IMAGE} AS base

# Pinned uv, per docs.astral.sh/uv/guides/integration/docker — matches the
# `required-version` bound in pyproject.toml's [tool.uv].
COPY --from=ghcr.io/astral-sh/uv:0.11.9 /uv /uvx /bin/

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    UV_COMPILE_BYTECODE=1 \
    UV_LINK_MODE=copy \
    UV_PYTHON_DOWNLOADS=0 \
    # infra/compose/docker-compose.yml bind-mounts the host source tree onto /app for
    # every one of the three services this image runs as. A venv created at the default
    # /app/.venv would sit inside that bind mount, which is exactly why compose also
    # layers a persistent named volume (api-venv) on top of that one path — but a named
    # volume is only ever seeded from the image once, while empty; a later image rebuild
    # never refreshes it, so a second dependency change would silently keep running the
    # first one. Keeping the venv outside /app avoids the collision entirely.
    UV_PROJECT_ENVIRONMENT=/opt/venv

WORKDIR /app

# ---- deps: resolve dependencies in their own cached layer ------------------
# Only pyproject.toml/uv.lock are bound here, so this layer is invalidated by a
# dependency change alone, not by every source edit — the same intent the old
# single-stage build had with `COPY pyproject.toml ./` before `COPY . .`.
FROM base AS deps

# psycopg[binary], cffi and argon2-cffi-bindings all resolve to prebuilt manylinux
# wheels for cp314 on both amd64 and arm64 (see uv.lock) — nothing here compiles, so
# no build toolchain is actually needed to populate this layer.
RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked --no-dev

# ---- dev: what infra/compose/docker-compose.yml's API_BUILD_TARGET=dev asks for
# Was previously silently broken — the Dockerfile only ever defined `base`, so
# `docker compose build api` (target: dev) has been failing outright.
FROM deps AS dev

RUN --mount=type=cache,target=/root/.cache/uv \
    --mount=type=bind,source=uv.lock,target=uv.lock \
    --mount=type=bind,source=pyproject.toml,target=pyproject.toml \
    uv sync --locked

ENV PATH="/opt/venv/bin:$PATH"

CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# ---- prod: no uv, no build toolchain in the image that actually ships -------
FROM ${PYTHON_IMAGE} AS prod

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Only the resolved environment crosses the stage boundary — nothing here ever
# compiled anything (see the note in `deps`), so there is no build toolchain to leave
# behind either way, but this also keeps the uv binary itself out of the shipped image.
COPY --from=deps /opt/venv /opt/venv
ENV PATH="/opt/venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

COPY . .

# Run as a non-root user: a container compromise should not be a root compromise.
RUN useradd --create-home --uid 10001 appuser && chown -R appuser:appuser /app
USER appuser

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://localhost:8000/healthz || exit 1

CMD ["gunicorn", "config.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--access-logfile", "-"]
