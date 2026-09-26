---
name: schoolhub-backend-module
description: Use when adding a Django module, a new resource (model + endpoints) to an existing module, or splitting a flat app into per-resource packages in apps/api — phrases like "add the library module", "add a backend resource for rooms", "new resource in timetable", "split fees_finance into packages", "finish the student_management migration", or any new file under `apps/api/apps/<module>/<resource>/`. Covers the ADR-0010 layout, RLS migration, permission keys, feature flag, route wiring, OpenAPI regeneration and the mandatory cross-tenant test. SKIP for frontend work (use schoolhub-api-services) and for test-only edits (use schoolhub-testing).
---

# SchoolHub Backend Module / Resource Skill

## Why this exists

Five apps were restructured from flat 1.5–1.9k-line `views.py`/`services.py` files into one
package per resource (about 30 refactor commits), and three are still flat. The layout is
settled in [ADR-0010](../../../docs/decisions/0010-backend-module-layout.md); cross-app
imports follow [ADR-0013](../../../docs/decisions/0013-cross-app-dependencies.md). This skill
is the checklist so nobody re-derives it from a module's §20.

**Reference implementation:** `apps/api/apps/timetable/` (four resource packages, a trimmed
root `views.py` holding only shared constants, a pure-aggregator `urls.py`).

## Read first

1. `docs/03-modules/<module>.md` — features, §4 permission keys, §11 validations, §16 endpoints.
2. `docs/05-database/entities/<domain>.md` — the columns.
3. `apps/api/AGENTS.md` hard rules (the `CLAUDE.md` in `apps/api/` loads it for you).

## Layout

```
apps/api/apps/<module>/
  models.py          # ALL models, at the app root (never split per resource)
  permissions.py     # registry.register(...) for every §4 key
  features.py        # the module's feature flag
  views.py           # only shared constants: FEATURE, STAFF_PERMISSIONS, shared view keys
  urls.py            # pure aggregator: include("<module>.<resource>.urls") per resource
  migrations/
  tests/             # module-wide: base.py, factories.py, test_cross_tenant.py
  <resource>/
    serializers.py  viewset.py  urls.py  filters.py
    services.py      # or services/<action>.py when actions have real separate logic
    tests/test_endpoints.py
```

## Checklist — new resource

0. **New module only — feature flag** in `features.py`:
   ```python
   from core.tenancy.features import registry

   registry.register("module.library", "Library (catalogue, loans, fines).", default_enabled=False)
   ```
   Every viewset then declares `required_feature = "module.library"` (usually via a `FEATURE`
   constant in the root `views.py`).
1. **Model** in `models.py`, inheriting `core.tenancy.models.TenantOwnedModel` (gives `tenant`,
   timestamps, the tenant-scoped default manager). Soft delete via `deleted_at`.
2. **Migration**, and for a new table, RLS in the same or the next migration:
   ```python
   from core.tenancy.rls import rls_operations

   operations = [
       *rls_operations("rooms"),   # one or more table names
   ]
   ```
   `apps/api/tests/test_rls_coverage.py` fails the build if a tenant table ships without a
   policy. Migrations ship in the module's PR (not a separate one); `.claude/rules/migrations.md`
   has the rest.
3. **Permission keys** from the module doc's §4, registered in `permissions.py`:
   ```python
   from core.rbac.registry import registry

   registry.register("timetable.room.create", "Create rooms.", GRID_ADMINS)
   ```
   `apps/api/tests/test_endpoint_contracts.py` fails if a viewset declares an unregistered key.
4. **Viewset** in `<resource>/viewset.py` — declare the feature, the view key and a map for writes:
   ```python
   from core.api.pagination import PageNumberPagination   # NOT DRF's — ours keeps the envelope
   from core.api.viewsets import TenantScopedViewSetMixin

   class RoomViewSet(TenantScopedViewSetMixin, viewsets.ModelViewSet):
       permission_classes = STAFF_PERMISSIONS     # from the module's root views.py
       queryset = Room.objects                    # tenant-scoped default manager — never all_tenants
       required_feature = FEATURE
       required_permission = "timetable.timetable.view"
       required_permission_map = {
           "create": "timetable.room.create",
           "update": "timetable.room.update",
           "partial_update": "timetable.room.update",
           "destroy": "timetable.room.delete",
       }
       http_method_names = ["get", "post", "patch", "delete", "head", "options"]
       pagination_class = PageNumberPagination    # bounded admin lists page by number (api-architecture.md §2.4)
   ```
   **Every write action must be in `required_permission_map`.** `HasPermissionKey` falls back to
   `required_permission` for any action missing from the map (`core/rbac/permissions.py`), so a
   forgotten `update` lets `PUT` through on the *view* key. Restrict `http_method_names` to what
   the module doc's §16 actually exposes. The default paginator is a cursor paginator; bounded
   admin lists use `core.api.pagination.PageNumberPagination`.
   Business rules go in `services.py`, not the viewset or serializer (fat services, thin views).
   Another module's data is changed only through *its* services (ADR-0013). Any query inside a
   loop is an N+1 — use `select_related`/`prefetch_related`.
5. **Routes** in `<resource>/urls.py` with `SimpleRouter(trailing_slash=False)`, included from the
   module's `urls.py`. A new module also needs one line in `config/api_v1.py` and one entry in
   `MODULE_APPS` (`config/settings/base.py`) — nothing else in `config/` changes.
6. **Contract:** regenerate and commit both, in the same commit:
   ```bash
   apps/api/scripts/generate-openapi.sh
   pnpm --filter @schoolhub/api-client generate
   ```
7. **Tests** — load `schoolhub-testing`. `<resource>/tests/test_endpoints.py` for behaviour and
   permissions (`self.allow("module.resource.action")` from the module's `tests/base.py`), plus
   entries in the module's `tests/test_cross_tenant.py` asserting **404, never 403**. Nothing
   auto-enrols new routes for cross-tenant coverage — a missing entry fails nothing, so write it.
8. **Docs** in the same PR: module doc (behaviour/endpoints), its §20 "Implementation notes" if
   the layout or a shared surface changed, and `docs/project-status.md`.

## Checklist — splitting a flat app

1. Trace every function/class in the flat `services.py`/`views.py`/`serializers.py`/`filters.py`
   to exactly one resource. Anything genuinely shared stays at the root and is named in §20.
2. Move one resource per commit: create `<resource>/`, move code, repoint imports, update the
   aggregator `urls.py`, delete the moved code from the root file. **Don't leave both copies
   wired** — `student_management`'s root `views.py` still redefines viewsets its packages have.
3. `models.py`, `permissions.py`, `features.py`, `tasks.py`, `uploads.py` stay at the root
   (Django/Celery autodiscovery needs them there).
4. No behaviour change: the OpenAPI schema should regenerate identical. If it doesn't, stop and
   find out why before continuing.
5. Record the split in the module doc's §20 (see `docs/03-modules/academics.md` §20).

## Don't

- Don't import another app's `views`/`viewset`/`urls`/`reports`/`tasks` (ADR-0013).
- Don't read `os.environ` outside `config/settings/*` (ADR-0014).
- Don't hand-edit `openapi.yaml` or `schema.d.ts`.
- Don't run the test suite locally — push and read CI (ADR-0007).
