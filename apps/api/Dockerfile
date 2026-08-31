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
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

# ---- deps: resolve dependencies in their own cached layer ------------------
# Only pyproject.toml/uv.lock are bound here, so this layer is invalidated by a
# dependency change alone, not by every source edit — the same intent the old
# single-stage build had with `COPY pyproject.toml ./` before `COPY . .`.
FROM base AS deps

RUN apt-get update \
    && apt-get install -y --no-install-recommends build-essential libpq-dev \
    && rm -rf /var/lib/apt/lists/*

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

ENV PATH="/app/.venv/bin:$PATH"

CMD ["python", "manage.py", "runserver", "0.0.0.0:8000"]

# ---- prod: no uv, no build toolchain in the image that actually ships -------
FROM ${PYTHON_IMAGE} AS prod

RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq5 curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Only the resolved environment crosses the stage boundary — build-essential and
# libpq-dev, needed to compile psycopg's binary wheel, never reach this image.
COPY --from=deps /app/.venv /app/.venv
ENV PATH="/app/.venv/bin:$PATH" \
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
