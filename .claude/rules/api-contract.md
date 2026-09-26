---
paths:
  - "apps/api/**/serializer*.py"
  - "apps/api/**/view*.py"
  - "apps/api/**/urls.py"
  - "apps/api/**/filters.py"
  - "apps/api/core/api/*.py"
---

# You are editing the API contract

A change to a serializer, view, viewset, URL or filter set (or to `core/api`'s envelope,
pagination or exception handling) can change `apps/api/openapi.yaml`, and through it
`packages/api-client/src/schema.d.ts`. Both are generated and committed
([ADR-0005](../../docs/decisions/0005-generated-api-contract.md)). Before committing:

```bash
apps/api/scripts/generate-openapi.sh               # refresh apps/api/openapi.yaml
pnpm --filter @schoolhub/api-client generate       # refresh the typed client schema
```

Commit both **in the same commit** as the backend change. CI regenerates each and fails on any
diff (`api.yml` "OpenAPI schema is current", `frontend.yml` "Lint · Typecheck"). Never hand-edit
either file.

Also check: every endpoint declares a registered `module.resource.action` key
(`required_permission` / `required_permission_map`); cross-tenant access returns 404; a breaking
change needs a new version path (`docs/02-architecture/api-architecture.md` §2.1).
