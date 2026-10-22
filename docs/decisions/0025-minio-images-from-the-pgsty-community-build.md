# 0025. Local and CI object storage runs pgsty's community MinIO build, pinned by digest

- **Status:** Accepted
- **Date:** 2026-10-22
- **Enforced by:** `infra-compose.yml`'s "Assert the pinned image versions" step (both MinIO images keep their tag and `@sha256:` digest), and the `e2e-live` workflow, which brings the stack up and fails on an image that can't be pulled or started (nightly and on dispatch, not a PR gate)

## Context

`infra/compose/docker-compose.yml` runs MinIO as the S3 stand-in for local development and the
`e2e-live` stack; production uses S3 itself. MinIO archived its community repository in April 2026
and deleted `minio/minio` and `minio/mc` from Docker Hub in September 2026, and `quay.io/minio/*`
refuses anonymous pulls. Every `e2e-live` run has failed at `docker compose up` since, before a
single test (each nightly on `main` from at least 2026-10-18).

## Decision

Both services use the [pgsty](https://github.com/pgsty/minio) community build: `pgsty/minio` and
`pgsty/mc` on Docker Hub, each pinned by release tag **and** image-index digest
(`image: pgsty/minio:RELEASE.…@sha256:…`), so a re-pushed tag can't change what runs. The pinned
server image keeps upstream's layout (its entrypoint prepends `minio` to `server /data`, and it
ships `mc` for the `mc ready local` healthcheck); the client image has a shell for `minio-init`'s
script. Nothing else in the compose file changes.

## Alternatives considered

- **`quay.io/minio/minio`** — why not: it refuses anonymous pulls, so it fails the same way.
- **`pgsty/silo`**, the same maintainer's continuing line — why not: its server binary is `silo`
  with no `minio` alias, so the command, entrypoint and healthcheck would all need rewriting and
  checking again. The last MinIO-named build is a drop-in, and for a local stand-in a frozen server
  is acceptable.
- **`cgr.dev/chainguard/minio`** — why not: the free tier serves only `latest`, which can't be
  pinned to a release.
- **`bitnamilegacy/minio`** — why not: frozen in mid-2025, and Bitnami's entrypoint and variables
  would mean rewriting both services.
- **Another S3-compatible store (SeaweedFS, Garage), or building MinIO ourselves** — why not: a
  migration or an image to maintain, where the stack only needs to behave like S3 for signed URLs
  and key prefixes, which MinIO still does.

## Consequences

- The images come from a community maintainer, not MinIO; the digest pin is what makes that
  acceptable, and a bump is a reviewed change of both tag and digest (the index digest from the
  registry's `docker-content-digest` header, not one platform's manifest).
- `pgsty/minio` is frozen at `RELEASE.2026-08-04T00-00-00Z` and gets no further fixes. Later
  server releases ship as `pgsty/silo`; moving there is a new decision that re-checks the
  entrypoint, the `command` and whether the image still ships `mc` for the healthcheck.
