# 0010. Backend apps use one package per resource, with `models.py` at the app root

- **Status:** Accepted
- **Date:** 2026-09-26
- **Enforced by:** review only — the [`schoolhub-backend-module`](../../.claude/skills/schoolhub-backend-module/SKILL.md) skill documents the layout, and the [`change-reviewer`](../../.claude/agents/change-reviewer.md) agent checks new code against it

## Context

The first apps put every resource into shared `views.py`, `services.py`, `serializers.py` and
`filters.py` files, which grew to 1.5–1.9k lines. Five apps have since been restructured into
per-resource packages (`academics`, `communication`, `school_organization`,
`staff_management`, `timetable`), and each module doc's §20 records the refactor (for
example [`academics.md`](../03-modules/academics.md) §20). Three apps remain flat
(`attendance`, `examinations`, `fees_finance`). `student_management` is half-migrated: its
packages exist but the root `views.py` (918 lines) still wires the old code.

## Decision

A new app, or a resource added to an existing app, uses this layout:

```
apps/<module>/
  models.py            # all models stay here, at the app root
  permissions.py  features.py  tasks.py  uploads.py   # where Django/Celery autodiscovery needs them
  <resource>/
    serializers.py  viewset.py  urls.py  filters.py
    services.py        # or services/<action>.py when actions have real separate logic
    tests/
```

A root `services.py` or `views.py` survives only as a deliberate shared surface that other
apps or sibling packages import, stated in the module's §20.

## Alternatives considered

- **Flat app files** — why not: they reached 1.5–1.9k lines, and the most fix-churned files in
  the repo are the flat apps' `services.py`.
- **Split `models.py` per resource too** — why not: Django migrations and cross-resource
  foreign keys are simpler with one models module, and none of the migrated apps needed it.
- **Always `services/<action>.py`** — why not: resources with little per-action logic read
  better as one file (`academics.md` §20's reasoning for `promotions/`).

## Consequences

Converting the flat apps and finishing `student_management` are backlog items, not
prerequisites. Until then new code in a flat app follows that app's existing shape rather
than half-splitting it.
