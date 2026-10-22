# syntax=docker/dockerfile:1
# Build context is the WORKSPACE ROOT, not this directory: the app imports
# packages/* and installs from the root lockfile, so a narrower context cannot
# resolve them. Adapted from the official example at
# https://github.com/vercel/next.js/tree/canary/examples/with-docker for a
# pnpm workspace.
#
# Two targets: `runner` is the production image; `dev` is what
# infra/compose/docker-compose.yml's FRONTEND_BUILD_TARGET=dev runs, with the
# repo bind-mounted over /app and `next dev` hot-reloading it.

# The base image, pinned in one place per image like apps/api's PYTHON_IMAGE
# (infra/AGENTS.md's version table).
ARG NODE_IMAGE=node:24-slim

FROM ${NODE_IMAGE} AS deps
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable pnpm
# Only the manifests, so the install layer caches until dependencies change.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY apps/website/package.json apps/website/
COPY packages/ui/package.json packages/ui/
COPY packages/types/package.json packages/types/
COPY packages/api-client/package.json packages/api-client/
COPY packages/config/package.json packages/config/
RUN --mount=type=cache,target=/pnpm/store pnpm install --frozen-lockfile

# ---- dev: the compose service's target. No build: the service bind-mounts the
# source and starts `next dev`; `deps` already enabled pnpm and installed the
# workspace, which seeds the service's node_modules volumes.
FROM deps AS dev
ENV NODE_ENV=development
ENV NEXT_TELEMETRY_DISABLED=1

FROM ${NODE_IMAGE} AS builder
WORKDIR /app
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN corepack enable pnpm
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/website/node_modules ./apps/website/node_modules
COPY --from=deps /app/packages ./packages
COPY . .
RUN pnpm --filter @schoolhub/website build

FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
ENV HOSTNAME="0.0.0.0"
ENV NEXT_TELEMETRY_DISABLED=1

# standalone already contains the server and its traced dependencies; static and
# public are served alongside it.
COPY --from=builder --chown=node:node /app/apps/website/.next/standalone ./
COPY --from=builder --chown=node:node /app/apps/website/.next/static ./apps/website/.next/static
COPY --from=builder --chown=node:node /app/apps/website/public ./apps/website/public

USER node
EXPOSE 3000
# Tracing from the workspace root preserves the apps/<name> path inside standalone.
CMD ["node", "apps/website/server.js"]
