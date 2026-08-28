# syntax=docker/dockerfile:1
# Build context is the WORKSPACE ROOT, not this directory: the app imports
# packages/* and installs from the root lockfile, so a narrower context cannot
# resolve them. Adapted from the official example at
# https://github.com/vercel/next.js/tree/canary/examples/with-docker for a
# pnpm workspace.
#
# Note: for day-to-day development on macOS, Next.js recommends running
# `pnpm dev` natively rather than in Docker. These images are for
# production-shaped builds.

ARG NODE_VERSION=24-slim

FROM node:${NODE_VERSION} AS deps
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

FROM node:${NODE_VERSION} AS builder
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

FROM node:${NODE_VERSION} AS runner
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
