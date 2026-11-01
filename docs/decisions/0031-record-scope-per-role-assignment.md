# 0031. A record scope narrows only the keys its own role assignment grants

- **Status:** Accepted
- **Date:** 2026-11-02
- **Enforced by:** `scope_queryset`'s required `permission` keyword (a caller that names no key is a `TypeError`); `apps/api/core/rbac/tests/test_scope_grants.py` (only the roles granting a key count, `AnyOf` unions, a soft-deleted role and an on-commit eviction drop a warm cache); `apps/api/tests/test_per_role_scope.py` (`test_unrelated_all_role_does_not_widen_campus_scope`, `test_nested_route_needs_the_parents_view_scope`, the attendance, finance and exam report cases, `test_get_overflow_export_uses_the_view_scope`, `test_legacy_export_job_without_key_fails_closed`, and `DetailWriteScopeTests`: a PATCH or colon action outside the view scope is a 404); `test_staff_correction_target_needs_the_staff_attendance_view_scope` in `attendance/tests/test_staff_corrections.py`; `test_a_student_outside_the_generate_keys_scope_is_dropped` in `student_management/tests/test_import_export_idcards.py`; `apps/api/core/rbac/tests/test_holds_key_for.py`; `test_unrelated_all_role_*` in `attendance/tests/test_leave.py`, `attendance/tests/test_marking.py` and `examinations/tests/test_marks.py`; `student_management/tests/test_record_scope.py` (medical notes, capacity override, clearance waiver); `apps/api/tests/test_endpoint_contracts.py` (every key passed to `holds_key_for`, `scope_queryset` or `scopes_for` is readable and registered, and so is every `scope_read_permission`). Naming the right key at a new call site is review only

## Context

[auth-and-rbac.md §2.3](../02-architecture/auth-and-rbac.md) attaches a record scope to a
`user_role`, but `core.rbac.permissions.user_scopes` unioned every role's scope whatever the
role granted. A user with a campus-A role and any unrelated `all` role therefore read
tenant-wide on every scoped endpoint, entered marks for subjects they were not allocated, and
escalated leave on any campus. Communication PR C fixed only the broadcast check, with
`user_scopes_for_key`. `docs/deferred-work.md` recorded the rest as high priority. Decided in
plan `docs/superpowers/plans/2026-11-02-per-role-record-scope.md` (PR A); PR B appends the
mixed-scope-type union to this record.

## Decision

1. **One resolver, one cache entry.** `scope_grants(user)` maps each held key to the scopes of
   the live assignments, of live roles, that grant it. It is one query, cached as
   `scope-grants:{pk}` for 300 s. `effective_permission_keys` is its key set, so keys and
   scopes cannot disagree. `scopes_for(user, declared)` reads it for one key or `AnyOf`, and an
   `AnyOf` unions the roles of every key it names.
2. **Every scoped read names its key.** `scope_queryset(..., permission=...)` is required and
   keyword-only. The viewset mixin passes `required_declaration(request, view)`, and a route
   with no declaration reads `.none()`. `user_scopes`, `user_scopes_for_key` and the
   presence-only `has_permission_key` are deleted.
3. **A route that acts on a row must reach it under the read key and under its own
   declaration** (user decision, 2026-11-02). In `TenantScopedViewSetMixin.get_queryset`, when
   the route's declaration differs from the viewset's read key, the queryset is scoped by the
   read key first and then by the declaration, two chained `scope_queryset` calls with the
   viewset's `scope_kwargs()`. That covers PATCH, PUT, DELETE and every colon action resolved
   through `get_object()` or `get_queryset()`; where the two are equal it is one call. The
   read key is `required_permission`, unless the class names another in
   `scope_read_permission` (`AttendanceCorrectionViewSet` reads its queue under
   `AnyOf(correction.create, correction.approve)`). An action in `scope_read_exempt_actions`
   is scoped by its own key alone (`NoticeViewSet`'s `acknowledge`, whose guardians and
   students hold no `communication.notice.view`). Code that resolves a target outside the
   mixin chains the same two calls by hand: a nested route's parent, an attendance
   correction's student or staff row, a staff thread's student, and timetable `:validate`
   and `:publish`. Substitution `candidates` is the exception (plan, execution ruling 4): the
   slot is scoped by the substitution key alone, and the staff list it returns by
   `staff.staff.view`, because the answer is a list of staff and discloses nothing of the
   slot. A target outside either scope is a 404.
4. **A privilege applied to one row asks `holds_key_for(user, permission, row, ...)`**, which
   is `scope_queryset` over that row. It takes the scope settings of the viewset that serves
   the row: `TenantScopedViewSetMixin.scope_kwargs()`, or `SECTION_SCOPE` across an app
   boundary. The capacity override, the clearance waiver and substitution cancel use it. The
   medical-notes shortcut honours the update key's scope for each row, read once per page
   rather than per row.
5. **An export job carries its key.** The enqueuing request's declaration is stored in the job
   payload as `scope_permission` (`core/exports/scope.py`), and the task scopes every row by
   it. A job queued before this change has none: it is marked failed and tells the user to
   request the export again.
6. **Eviction is immediate and on commit.** `core/rbac/cache.py` holds the only prefix.
   `evict_rbac_caches` deletes now, so the rest of the transaction reads the change, and again
   in `transaction.on_commit`, so a concurrent read between the two cannot re-cache the old
   grants. It fires on `UserRole`, `RolePermission` and role-permission m2m changes, on a
   `Role` `post_save` (a soft delete is a save) and `post_delete`, and after seeding's
   `bulk_create`.

## Alternatives considered

| Decision | Chosen | Rejected, and why |
| -------- | ------ | ----------------- |
| Where the key comes from | An explicit, required `permission` keyword | **A context variable set by `HasPermissionKey`:** absent in Celery and services, and a missing value would fall back to the bug. **An optional argument defaulting to the old union:** leaves the hole open for any forgotten caller. |
| Resolver and cache shape | One map, `scope_grants`, from one query, cached as `scope-grants:{pk}` | **A cache entry per (user, key):** eviction cannot enumerate the keys. **Uncached:** the medical-notes check runs per row. **A separate `perm-keys` cache:** two caches that can disagree for a TTL. |
| `AnyOf` routes | The union of the roles granting any declared key | **The first key that matched:** order-dependent. |
| Writes that resolve a target | The target's view scope **and** the action's scope, applied by the mixin to every viewset, with a named read key or exempt action where the class needs one | **The action key alone:** acts on rows the user cannot read (attendance.md §16). **The view key alone:** brings the exploit back through an unrelated view role. **An opt-in per viewset:** every class that forgets it keeps the hole. |
| How an export job learns its key | The enqueuing request's declaration, as `scope_permission` | **Derived from the job type:** a `GET` over the inline ceiling queues the same job under the *view* key, so a view-only user would get an empty file, or a wider export role a wider one. |
| Old API | Delete `user_scopes`, `user_scopes_for_key`, `has_permission_key` | **Deprecate them:** the next caller reaches for the shorter name. |
| Role soft delete | Filter `role__deleted_at` in the grants query and `live_restricted_role_assignments`, plus a `Role` `post_save` eviction | **A separate PR:** the same functions are rewritten here. |
| Eviction timing | Now **and** on commit (Django's documented pattern) | **Now only:** a concurrent read between eviction and commit re-caches the old grants for the full TTL. |
| Medical-notes shortcut | Honours the update key's scope per row | **Defer:** the same bug class, on medical data, in a function this change rewrites. |

## Consequences

- A mixed user loses reach they never should have had. The seeded users each hold one role,
  and production writes only `all`-scoped assignments today (`staff/services/invite.py`), so
  nothing seeded or live changes. This must land before role management writes others.
- **Rolling deploy window.** Old pods evict the retired `perm-keys`/`scopes` entries, not
  `scope-grants`, and new pods do the reverse. While both run, a role change made on one
  generation can be read stale by the other for up to the 300 s TTL.
- **Exports queued before the deploy fail** with a request to export again, rather than reading
  under no key or every key.
- A scoped read written without a key does not run, and a row privilege must use
  `holds_key_for`. Choosing the right key is still review only.
- `holds_key_for` costs one query per check, even for an `all` holder.
- Until PR B, one key held at two scope types still takes the first of
  `all` > `campus` > `own` > `assigned` (the two attendance entries in `deferred-work.md`).
- Unchanged by design: the broadcast recipient side (ADR-0029 decision 5).
- Left for a follow-up (`deferred-work.md`): promotion approver notifications and
  `notify_result_approval_pending` (`apps/examinations/tasks.py`) reach every holder of the
  approve key, whatever its scope.
- Pre-existing and still open: with `ATOMIC_REQUESTS`, a read inside the request after an
  eviction re-caches the uncommitted grants; if the request then rolls back, those rolled-back
  grants stay cached for up to 300 s (`deferred-work.md`).
