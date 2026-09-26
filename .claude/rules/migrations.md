---
paths:
  - "apps/api/**/migrations/*.py"
---

# You are editing a migration

- **New tenant-owned table → RLS policy.** Add `*rls_operations("<table>", ...)` from
  `core.tenancy.rls` in the same or the next migration
  ([ADR-0003](../../docs/decisions/0003-tenant-isolation-rls.md)).
  `apps/api/tests/test_rls_coverage.py` fails the build if a tenant table has no policy.
- **Reversible**, and **expand → migrate → contract** for anything that could break the running
  version: never add and drop the same structure in one release (`infra/AGENTS.md` rule 6).
- **Migrations ship in the module's PR**, alongside the model change — not in a separate PR.
  (A "migrations in their own PR" rule from other codebases does not apply here.)
- **Never grant `BYPASSRLS` or change table ownership** in a migration; the app role owns nothing.
- Don't edit a migration that has merged to `main` — add a new one.
- CI's `makemigrations --check` (in `api.yml`) fails if a model change has no migration.
