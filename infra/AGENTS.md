# AGENTS.md — infra/

Instructions for AI assistants and engineers working on SchoolHub's infrastructure: the local
compose stack, PostgreSQL roles, Terraform and runbooks. Read the root
[`../AGENTS.md`](../AGENTS.md) first — it holds the repo-wide rules.

## The specification

The authoritative specification is [`../docs/`](../docs/), in this same monorepo. Nothing here
restates it; this directory implements it. If this directory and the spec disagree, **the spec
is right and this directory is the bug** — unless the version table below says otherwise.

### Read before you change anything here

Do **not** load the whole spec. Open `docs/context/context-map.md`, then read only what
your task needs. For infrastructure work that is almost always:

| File in `docs/02-architecture/` | Governs |
| --- | --- |
| `hosting-deployment.md` | Environments, CI/CD, DNS/TLS, secrets, migrations in deploys, backup/restore, rollback, DR targets |
| `database-architecture.md` | RLS mechanics, `app.tenant_id` GUC, PgBouncer interplay, backup/PITR |
| `multi-tenancy.md` | Tenant resolution, wildcard subdomains, custom domains, tenant lifecycle |
| `repo-structure.md` | The monorepo layout as built, and env/config policy (§4) |
| `tech-stack.md` | Technology choices — §8 has the pinned versions |

Anything the spec marks "(recommendation)" is not client-confirmed. Implementing it is fine;
changing it is also fine — but change the spec doc in the same pull request.

### Versions: pinned ahead of the original spec, deliberately

The spec's original recommendations (`tech-stack.md` §7) predate the pins below; `tech-stack.md`
§8 is the authority for as-built versions; this table mirrors it for the infrastructure
components and says where each pin lives. Keep the two in step:

| Component | Original spec | Pinned | Where |
| --- | --- | --- | --- |
| PostgreSQL | 16 | **18** (`postgres:18-alpine`) | `compose/docker-compose.yml`, `terraform/modules/database` |
| Redis | 7 | **8** (`redis:8-alpine`) | `compose/docker-compose.yml`, `terraform/modules/cache` |
| Python | 3.12 | **3.14** (`python:3.14-slim`) | `PYTHON_IMAGE` build arg |
| Node | 20 | **24 LTS** (`node:24-alpine`) | `NODE_IMAGE` build arg |
| PgBouncer | unspecified | latest stable, transaction mode | `postgres/pgbouncer/pgbouncer.ini` |
| Terraform | unspecified | `>= 1.9`, AWS provider `~> 6.0` | `terraform/**` |

The major version is pinned in exactly one place per component and flows outward from there.
Dev, CI and production must always agree — RLS and planner behavior are what the test suite
asserts, and a version skew makes those assertions meaningless.

## Where the consumers live

| Path | Contents |
| --- | --- |
| `docs/` | The specification (source of truth) |
| `apps/api` | Django 6.1 + DRF + Celery backend |
| `apps/dashboard`, `apps/website` | Next.js 16 admin dashboard and multi-tenant website renderer |
| `infra/` | This directory |

The only artefact shared between the API and the frontends is the OpenAPI contract
([ADR-0005](../docs/decisions/0005-generated-api-contract.md)). Infrastructure shares nothing
with them at runtime — it provisions, and they consume through environment variables.

## Non-negotiable infrastructure rules

1. **The application database role must never have `BYPASSRLS` and must never own the tables.**
   `postgres/init/02-app-role.sql` is the single most important file in this repo. RLS is the
   authoritative tenant boundary; a role change can silently delete that boundary while every
   test still passes. Any diff touching roles, ownership, `GRANT`, or `ALTER DEFAULT PRIVILEGES`
   needs a security review.
2. **PgBouncer runs in transaction pooling mode.** Therefore: `SET LOCAL app.tenant_id` inside a
   transaction only. Never session-level `SET`, never session advisory locks, never session-scope
   prepared statements, never `LISTEN`/`NOTIFY` in application code.
3. **PostgreSQL 18 is pinned.** Not `latest`, not a floating major. Local dev, CI and production
   run the same major version, because RLS and planner behavior are what we test. The same rule
   applies to Redis 8, Python 3.14 and Node 24 — see the version table above.
4. **No secrets in git.** Only `*.example` files with dummy values and a comment saying where the
   real value comes from. gitleaks runs pre-commit (when installed locally) and in CI. If a secret is ever committed,
   rotate it — deleting the commit is not remediation.
5. **Immutable images, external config.** One image per service per commit, tagged with the git
   SHA; the same image is promoted staging → production. Never rebuild between environments.
6. **Expand–contract migrations.** A release never both adds and drops the same structure. The
   migrate job runs before new code serves traffic, so the previous version must keep working
   against the migrated schema — that is what makes rollback a one-command operation.
7. **Nothing exists only in a console.** Every piece of infrastructure is reproducible from this
   repo plus the secret store plus backups. Click-ops changes must be back-ported the same day.
8. **Terraform under `terraform/` is not applied yet.** It is the Phase 6 AWS target. Do not add
   an apply step to CI, and do not put state, credentials, or real account IDs in it.
9. **`celery-beat` runs exactly one task. Ever.** A second scheduler double-fires every periodic
   job — duplicate fee reminders to parents, duplicate retention purges. `modules/ecs-service`
   refuses `desired_count > 1` for that service; do not work around it.
10. **The CDN cache key must include the `Host` header.** Tenant identity on the public website is
    the hostname. A cache that ignores `Host` serves one school's pages under another school's
    domain — cross-tenant exposure, from the edge, to the public.

## Conventions

- Shell scripts: `bash`, `set -euo pipefail`, no positional-argument guessing — validate inputs
  and print usage.
- Every runbook has: purpose, preconditions, numbered steps, verification, rollback. Keep them
  short enough to be followed at 3am.
- Terraform: one concern per module, variables typed and described, no hardcoded account IDs or
  regions inside modules, outputs for anything another module or a human needs.
- YAML/HCL/SQL/INI in this repo must be valid and parseable. Do not commit stubs or placeholders
  that would fail to load.
