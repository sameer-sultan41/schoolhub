# Communication Module Implementation Plan (Phase 2, Tier 4)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the `communication` backend module — tenant-editable notification templates and per-user channel preferences (extending the `core/notifications` machinery that attendance, fees-finance and examinations already call), announcements and formal notices with a publish-approval workflow, guardian/staff message threads, and an emergency multi-channel broadcast — closing Phase 2 Tier 4's first module.

**Architecture:** One Django app `apps/api/apps/communication/`, on the same spine every shipped module uses: `TenantOwnedModel` + `NNNN_rls_policies.py`, code-declared permission/feature/upload registries, fat `services.py` with thin viewsets, a `reports.py` of pure `assertNumQueries`-proven query functions. PR A extends `core/notifications/` — which already owns `notifications`/`delivery_logs`, `notify()`, the platform-default template registry and the two working adapters (in-app, email), per that module's own docstring's ownership split — with a tenant-override resolution hook and a preference-gating hook, both registered from `communication` at app-ready so `core/` never imports a Tier-4 app. PR B and C are pure `communication` app work.

**Tech Stack:** Python 3.14 · Django 6.1 · DRF 3.18 · PostgreSQL 18 (RLS) · Celery 5.6 · drf-spectacular · uv · factory-boy · WeasyPrint.

**Spec:** `docs/03-modules/communication.md` (§4 permissions, §5–6 features, §7 workflows, §11 validations, §12 notifications, §13 reports, §16 endpoints, §19 recommendations) and `docs/05-database/entities/communication.md` (column-level schema, 8 tables — 2 of them already built in `core/notifications`). Secondary: `docs/02-architecture/notifications.md` (the machinery this plan extends), `apps/api/docs/ENGINEERING_STANDARDS.md`.

---

## Context

### The ownership split, and why PR A touches `core/`

`docs/05-database/entities/communication.md`'s `notifications` section states it plainly: *"Owned by `core/notifications/`, not this module... Attendance (Tier 2) needs it long before communication (Tier 4) ships, so the split is: **here** — `notifications`, `delivery_logs`, the channel adapters, the platform default templates, and `notify()`. **communication (Tier 4)** — announcements, notices, message threads, plus `notification_templates` (tenant overrides), `notification_preferences`, the delivery dashboard, and the SMS/push/WhatsApp adapters."*

`core/notifications/` already exists (built ahead of schedule as attendance's own prerequisite) with `Notification`, `DeliveryLog`, `notify()`, a `TriggerCatalog`, a platform-default `TemplateRegistry`, and `InAppAdapter`/`EmailAdapter` (SMS/push/WhatsApp adapters are registered but raise `ChannelUnavailable` — no provider chosen yet, same shape as fees-finance's deferred payment gateway). Three modules (`attendance`, `fees_finance`, `examinations`) already call `notify()` in production.

`notify()`'s current architecture renders the in-app template **once**, inside the caller's transaction, and stores that single rendered `(title, body)` on the `Notification` row; every channel's delivery reuses that same string (`tasks.py`'s `_attempt`: *"The stored title/body are already rendered; re-rendering here would need the original context, which is deliberately not persisted (it carries the PII the template pulled from)"*). That is a deliberate, already-debugged decision (a prior HTML-escaping bug came from exactly this point) and this plan does not reopen it. Tenant-editable **per-channel** bodies (a fee reminder's SMS wording is not its email wording) therefore cannot be bolted on by editing the stored `Notification.title/body` — they need per-channel rendering to happen where `_delivery_for` already runs, inside the same transaction, using the same context that is about to go out of scope. Task A1 does exactly that: it adds `subject`/`body` columns to `DeliveryLog` and renders each channel there, so no PII is newly persisted that was not already being read at that instant.

`core/` must not import `apps.communication` (a Tier-4 app importing back into `core/` would invert the dependency direction every other module respects). So both extension points are **hooks the communication app registers into at `AppConfig.ready()`** — `core.notifications.templates.set_override_resolver(fn)` and `core.notifications.services.set_preference_resolver(fn)` — mirroring the self-registration pattern `features.py`/`permissions.py`/`catalog.py` already use throughout the platform. Until communication's `AppConfig.ready()` runs (i.e. on `main` today), both hooks are `None` and `notify()` behaves exactly as it does now — this is an additive, backward-compatible change verified by the three existing callers' own test suites staying green.

### Scope decisions taken up front (mirrors fees-finance's plan)

| Decision | Choice | Consequence |
| -------- | ------ | ----------- |
| Locale variants | **Deferred.** All rendering is `locale="en"` | `User` has no locale field today; §2's "English + Urdu" is a translation-content project, not a code gap. `notification_templates.locale` column ships (so the schema matches the entity doc and a later PR adds real variants with no migration), but only one row per `(tenant, code, channel)` is ever created in this plan. Recorded in §20. |
| SMS / push / WhatsApp providers | **Not built.** Adapters stay `ChannelUnavailable` | No `core/integrations` exists (same reasoning fees-finance's plan gave for the payment gateway — hard rule 6). Triggers still declare these channels per the module doc; they record `skipped` with a named reason, which is correct and observable, not silently wrong. |
| `GET /announcements`, `GET /notices` visibility | **Staff-only** (`view` key), guardians/students consume via the existing `GET /notifications` inbox | §4's permission table grants guardians/students only `notice.acknowledge` and `thread.*` (own scope) — no `announcement.view`/`notice.view` row. Audience-membership queryset filtering (`scope_queryset` has no "am I in this JSONB audience filter" scope type) is real work with no spec'd caller yet; parent-portal (Tier 5, unbuilt) is the documented consumption surface for a guardian browsing notices directly. Recorded in §20 as the gap parent-portal's plan must close. |
| Quiet hours, suppression lists, SMS credit quotas | **Deferred**, per `notifications.md` §4/§6/§7's own words ("communication-module scope") | No SMS provider exists yet either, so a quota against zero real sends has nothing to meter. Recorded in §20. |
| `message_threads.participant_user_ids` as JSONB vs. a join table | **JSONB**, per the module doc §19's own explicit deferral ("promote to a join table if group messaging grows") | `filter_owned_by_user` uses a JSONB `__contains` lookup; §19 already names the future migration. |
| PR slicing | **3 stacked PRs** | Templates+preferences+delivery dashboard (extends `core/`), announcements+notices, threads+emergency broadcast. |

---

## Global Constraints

From `AGENTS.md`, `apps/api/AGENTS.md`, `apps/api/docs/ENGINEERING_STANDARDS.md` and `~/.claude/CLAUDE.md`. Every task's requirements implicitly include this section — identical to the constraints the fees-finance plan ran under, since nothing about them is module-specific.

- **Step 0, before any branch:** `git fetch origin && git checkout -b <name> origin/main`. Each stacked PR branches off **its predecessor's branch**.
- **Merge one PR at a time and confirm GitHub retargeted the child before merging it** — `gh pr view <child> --json baseRefName` must read `main` before the child merges. Never pass `--delete-branch` while a stacked child still points at the branch.
- **Do not run tests, linters, typechecks or `manage.py` locally. Ever.** Commit, push, read CI (`gh pr checks <n> --watch`, `gh run view <id> --log-failed`). CI is the source of truth.
- **`main` moves only through a reviewed, CI-green PR**, merged with `gh pr merge --merge` (merge commit, not squash).
- **Never add `Co-Authored-By`** to a commit or PR body. **Never `--no-verify`.** **Never create/edit `.env` files** without asking first.
- **Backend only.** Nothing here touches `apps/dashboard/**`, `apps/website/**` or `packages/ui/**` — the other agent owns the frontend redesign. `packages/api-client/src/schema.d.ts` is generated output and *is* in scope.
- **AGENTS.md invariant 5 — AI drafts, humans publish.** §14's three AI capabilities (`AI-COM-01/02/03`) are out of scope: no `core/ai`, hard rule 6 forbids a direct provider SDK call.
- Every new tenant-owned table inherits `TenantOwnedModel` and gets an RLS policy via `rls_operations(...)` in a dedicated `NNNN_rls_policies.py`, or `tests/test_rls_coverage.py` fails the build.
- **Never `Model.objects.all()` on tenant-owned data.** Cross-tenant access returns 404, never 403 — one cross-tenant test per new endpoint.
- **Every endpoint declares `required_permission`/`required_permission_map`** (`tests/test_endpoint_contracts.py` enforces it) and a resolving `scope_campus_field` (`None` explicitly, or a real column — never left at a default that does not exist on the model).
- **`docs/03-modules/communication.md` is the requirement.** Endpoints from §16, keys from §4, validations from §11, notifications from §12. Do not invent an endpoint §16 does not list — document the omission in the §20 register style.
- **OpenAPI is generated** — `apps/api/openapi.yaml` and `packages/api-client/src/schema.d.ts` change in the same commit as the serializer that moved them.
- **Every new `status` enum needs a `SPECTACULAR_SETTINGS["ENUM_NAME_OVERRIDES"]` entry** (`config/settings/base.py:222`).
- **Doc-sync gate:** every PR touching `apps/**`/`packages/**`/`e2e/**` must also touch `docs/project-status.md`.
- Backend coverage floor is **85%** (`apps/api/pyproject.toml`), a ratchet. Ruff: line length 100, rules `E, F, I, UP, B, DJ, S, C4, RET, SIM`.
- New vocabulary goes in `.cspell/project-words.txt`. Docs are British English (`en-GB`).

---

## File Structure

### Modified: `apps/api/core/notifications/` (PR A)

| File | Change |
| ---- | ------ |
| `models.py` | `DeliveryLog` gains `subject`/`body` (nullable — in-app rows keep using `Notification.title/body` since there is no separate in-app "send", see Task A1). |
| `templates.py` | Add `set_override_resolver(fn)`, module-level `_override_resolver`, and `resolve(code, channel, *, tenant_id, locale="en")` — tries the resolver, falls back to `registry.get`. |
| `services.py` | Add `set_preference_resolver(fn)`. `notify()` renders per-channel via `templates.resolve` inside the same transaction; `_delivery_for` consults the preference resolver (bypassed entirely for `NotificationCategory.EMERGENCY`, matching the in-app mandatory-floor pattern already in `catalog.py`). |
| `migrations/0003_per_channel_render.py` | `AddField` for the two new `DeliveryLog` columns. |
| `tests/test_services.py`, `tests/test_templates.py` | Extend with the new hook contract, still green with no resolver registered (the three existing callers must not need a single line changed). |

### New: `apps/api/apps/communication/` — mirrors `apps/fees_finance/`

| File | Responsibility | PR |
| ---- | -------------- | -- |
| `apps.py` | `CommunicationConfig`, `label = "communication"`; `ready()` registers both `core/notifications` hooks | A |
| `features.py` | Registers `module.communication` | A |
| `permissions.py` | §4's `communication.*` keys, with default-role tuples | A–C |
| `uploads.py` | `communication.announcement-attachment`, `communication.notice-attachment`, `communication.thread-attachment` purposes | B, C |
| `notifications.py` | §12's seven triggers (birthday excluded — owned by certificates-documents, Tier 7, unbuilt; recorded in §20) | B, C |
| `models.py` | `NotificationTemplateOverride`, `NotificationPreference`, `Announcement`, `Notice`, `MessageThread`, `Message` | A–C |
| `templates_service.py` | `resolve_tenant_template(code, channel, locale, tenant_id)` — the function registered as `core.notifications.templates`'s resolver | A |
| `services.py` | All business rules; views and tasks call it | A–C |
| `serializers.py` | Shape validation only | A–C |
| `filters.py` | Whitelisted filtersets, every FK an explicit `UUIDFilter` | A–C |
| `views.py` | Thin viewsets + colon-actions, including a read-only `DeliveryLogViewSet` over `core.notifications.models.DeliveryLog` | A–C |
| `urls.py` | Explicit `path()` colon-actions before `*router.urls` | A–C |
| `tasks.py` | Celery: emergency broadcast fan-out, notice-acknowledgment reminder sweep | B, C |
| `reports.py` | §13's four reports as pure query functions, `assertNumQueries`-asserted | A, C |
| `documents.py` | Notice PDF builder over `core.documents` | B |
| `migrations/` | `0001_initial` → `0006_rls_policies` | A–C |
| `tests/{base,factories,test_models,test_templates,test_preferences,test_reports,test_announcements,test_notices,test_threads,test_broadcast,test_api,test_cross_tenant}.py` | Mirrors `fees_finance/tests/` | A–C |

### Modified elsewhere

- `config/settings/base.py` — `MODULE_APPS` += `"apps.communication"` after `"apps.fees_finance"`; `CELERY_BEAT_SCHEDULE` += the acknowledgment-reminder sweep; `ENUM_NAME_OVERRIDES` += every new status enum.
- `config/api_v1.py` — one `path("", include("apps.communication.urls"))`.
- `core/tenancy/models.py` — `TenantSettings` gains a `communication` JSON namespace (`notice_number_pattern`), matching the `hr`/`finance` precedent.
- `apps/api/openapi.yaml`, `packages/api-client/src/schema.d.ts` — regenerated.
- `docs/03-modules/communication.md` (§20 register), `docs/05-database/entities/communication.md`, `docs/project-status.md`, `.cspell/project-words.txt`.
- `e2e/tests/live/api/communication-*.spec.ts`, `core/rbac/management/commands/seed_e2e_data.py`.

---

# PR A — `feat/communication-templates-and-preferences`

**Deliverable:** a tenant can override any notification's per-channel wording, a user can opt individual channels off per category (emergency always stays on), and `school_admin`/`it_admin` can see a delivery dashboard — before a single announcement exists. `core/notifications`'s three existing callers (attendance, fees-finance, examinations) are unaffected: no resolver registered means byte-identical behaviour to today.

**Branch:** `git fetch origin && git checkout -b feat/communication-templates-and-preferences origin/main`

### Task A1: Per-channel rendering in `core/notifications`

**Files:** modify `core/notifications/{models,templates,services}.py`; new `core/notifications/migrations/0003_per_channel_render.py`; extend `core/notifications/tests/{test_services,test_templates}.py`.

- [ ] **Step 1: Write the failing tests**

```python
# core/notifications/tests/test_templates.py
def test_resolve_falls_back_to_the_platform_default_with_no_resolver_registered(self):
    """The default state on main today — every existing caller's contract."""

def test_resolve_prefers_the_registered_resolvers_result_when_it_returns_one(self):
    ...

def test_resolve_falls_back_to_platform_default_when_the_resolver_returns_none(self):
    """A tenant with no override for this (code, channel) — the common case."""

# core/notifications/tests/test_services.py
def test_notify_renders_a_distinct_body_per_channel_when_templates_differ(self):
    """The SMS body and the email body for the same trigger must be able to
    differ — the architectural gap this task closes."""

def test_in_app_rendering_is_unaffected_by_a_registered_preference_resolver(self):
    """The mandatory floor: in-app never asks the resolver."""

def test_a_preference_resolver_returning_false_skips_that_channel_with_a_named_reason(self):
    ...

def test_an_emergency_category_notification_ignores_the_preference_resolver_entirely(self):
    """Matches catalog.py's MANDATORY_CHANNEL reasoning: emergency cannot be
    configured away, so the resolver is never even called for it — a resolver
    bug can silently drop an in-app row but must never drop an emergency one."""

def test_with_no_resolvers_registered_notify_behaves_exactly_as_it_does_on_main(self):
    """Regression guard for attendance/fees_finance/examinations: run each
    existing module's own notify() call site fixture and assert unchanged output."""
```

- [ ] **Step 2:** `models.py` — add to `DeliveryLog`:

```python
subject = models.CharField(
    max_length=200, null=True, blank=True,
    help_text="Rendered for this channel specifically — NULL for in_app, which "
    "has no separate send and reuses Notification.title.",
)
body = models.TextField(
    null=True, blank=True,
    help_text="Rendered for this channel specifically — NULL for in_app.",
)
```

- [ ] **Step 3:** `templates.py` — add:

```python
from collections.abc import Callable
import uuid

_override_resolver: Callable[[str, str, str, uuid.UUID], "NotificationTemplate | None"] | None = None

def set_override_resolver(
    fn: Callable[[str, str, str, uuid.UUID], "NotificationTemplate | None"] | None,
) -> None:
    """Registered by communication's AppConfig.ready(). `None` (the default,
    and every state before communication's app-ready runs) means "no tenant
    ever has an override" — resolve() then behaves exactly like registry.get()."""
    global _override_resolver
    _override_resolver = fn

def resolve(code: str, channel: str, *, tenant_id: uuid.UUID, locale: str = "en") -> "NotificationTemplate | None":
    if _override_resolver is not None:
        override = _override_resolver(code, channel, locale, tenant_id)
        if override is not None:
            return override
    return registry.get(code, channel)
```

- [ ] **Step 4:** `services.py` — `set_preference_resolver` mirrors `set_override_resolver`. In `notify()`, replace the single `in_app = templates.get(...)` + one `render()` with: render in-app via `templates.resolve(trigger.template_code, NotificationChannel.IN_APP, tenant_id=tenant_id)` (unchanged behaviour, now tenant-override-aware) for `Notification.title/body`; then, in `_delivery_for`, for every non-in-app channel that has an adapter and an address, additionally resolve and render that channel's own template into the new `DeliveryLog.subject`/`body` columns — reusing the *same* `context` dict already in scope, inside the same `transaction.atomic` `notify()` already runs in. Preference gating: before building each non-emergency `DeliveryLog`, call the registered preference resolver (`None` registered ⇒ always enabled); a `False` result sets `status=SKIPPED, error_message="Disabled by user preference."` instead of `QUEUED`.

- [ ] **Step 5:** `tasks.py`'s `_attempt` — for a channel whose `DeliveryLog.body` is set, pass that instead of `notification.title/body`; unchanged for in-app (`delivery.body is None` there, by construction).

- [ ] **Step 6:** Migration, generated then read. Commit, push.

```
feat(notifications): per-channel rendering and a preference-gating hook
```

### Task A2: App scaffold, feature flag, permission keys, `TenantSettings` namespace

**Files:** create `apps/communication/{__init__,apps,features,permissions}.py`; modify `config/settings/base.py`, `core/tenancy/models.py`.

- [ ] **Step 1:** `apps.py`:

```python
class CommunicationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.communication"
    label = "communication"

    def ready(self) -> None:
        from core.notifications import services as core_services
        from core.notifications import templates as core_templates

        from apps.communication.templates_service import resolve_tenant_template
        from apps.communication.services import is_channel_enabled

        core_templates.set_override_resolver(resolve_tenant_template)
        core_services.set_preference_resolver(is_channel_enabled)
```

`features.py` registers `module.communication` (`default_enabled=False`). `MODULE_APPS` += `"apps.communication"` after `"apps.fees_finance"`.

- [ ] **Step 2:** `permissions.py` — role tuples, then `registry.register(...)` for §4's full table: `communication.announcement.{create,update,delete,publish}`, `communication.notice.{create,update,publish,acknowledge}`, `communication.broadcast.send`, `communication.thread.create`, `communication.message.create`, `communication.template.{view,update}`, `communication.notification-preference.update`, `communication.delivery-log.{view,export}`. Fill §4's view-key gaps in this same PR, named in the module docstring: `communication.announcement.view` (default: `school_admin`, `principal`, `teacher`, `reception`), `communication.notice.view` (same set).

- [ ] **Step 3:** `core/tenancy/models.py` — `TenantSettings` gains:

```python
communication = models.JSONField(
    default=dict, blank=True,
    help_text="Communication config, e.g. notice_number_pattern. Its own "
    "namespace for the reason `hr` and `finance` each got one.",
)
```

Generate and read the migration.

### Task A3: `notification_templates` and `notification_preferences`

**Files:** extend `models.py`, `services.py`, `templates_service.py`; create `migrations/0001_initial.py`, `0002_rls_policies.py`; `tests/{__init__,base,factories,test_models,test_templates,test_preferences}.py`.

- [ ] **Step 1: Write the failing tests**

```python
def test_a_tenant_can_override_the_body_of_a_platform_template(self):
    ...

def test_an_override_cannot_reference_a_variable_the_platform_template_did_not_declare(self):
    """§2's whitelist rule, enforced the same way templates.py's own
    _assert_placeholders_declared does — copy its regex and its reasoning
    docstring almost verbatim, since re-implementing template rendering in a
    tenant-facing PATCH is exactly the server-side-template-injection surface
    that docstring already argues against."""

def test_an_inactive_override_falls_back_to_the_platform_default(self):
    ...

def test_two_overrides_cannot_share_a_tenant_code_channel_locale(self): ...

def test_a_system_seeded_template_cannot_have_its_code_or_channel_changed(self):
    """is_system rows: body/subject editable, code/channel locked — the same
    is_system split fees_finance's LedgerAccount already uses."""

def test_disabling_the_emergency_category_is_refused(self):
    """§11: 'preference changes cannot disable the emergency category' —
    service-enforced, not a CHECK, because it is a category value comparison
    a CHECK could technically hold but every other cross-row/business rule in
    this codebase lives in services.py, and this one has a specific error
    message a CHECK cannot produce."""

def test_is_channel_enabled_defaults_to_true_with_no_preference_row(self):
    """A user who never touched their preferences gets every channel — the
    seed-free default, matching notify()'s own 'until preferences exist, every
    trigger delivers at the mandatory floor' framing from services.py's
    docstring, now generalized to 'no row means enabled'."""

def test_is_channel_enabled_is_a_single_query_regardless_of_how_many_channels_are_checked(self):
    """_delivery_for calls this once per (channel, recipient) in a fan-out of
    thousands — assertNumQueries against a per-tenant-user cache, mirroring
    core.rbac.permissions.user_scopes's cache-per-user pattern."""
```

- [ ] **Step 2:** Models per the entities doc.

```python
class NotificationTemplateOverride(TenantOwnedModel):
    code = models.CharField(max_length=100)
    name = models.CharField(max_length=150)
    channel = models.CharField(max_length=10, choices=NotificationChannel.choices)
    locale = models.CharField(max_length=10, default="en")
    subject = models.CharField(max_length=200, null=True, blank=True)
    body = models.TextField()
    variables = models.JSONField(help_text="Copied from the platform template at creation; validates edits.")
    is_system = models.BooleanField(default=False)
    is_active = models.BooleanField(default=True)

    class Meta:
        db_table = "notification_templates"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "code", "channel", "locale"],
                condition=models.Q(deleted_at__isnull=True),
                name="notification_templates_unique_live",
            ),
        ]
```

```python
class NotificationPreference(TenantOwnedModel):
    user_id = models.UUIDField()
    event_category = models.CharField(max_length=30, choices=NotificationCategory.choices)
    channel = models.CharField(max_length=10, choices=NotificationChannel.choices)
    is_enabled = models.BooleanField(default=True)

    class Meta:
        db_table = "notification_preferences"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "user_id", "event_category", "channel"],
                condition=models.Q(deleted_at__isnull=True),
                name="notification_preferences_unique_live",
            ),
        ]
```

Both import `NotificationChannel`/`NotificationCategory` from `core.notifications.models` — the single enum authority, never redeclared.

- [ ] **Step 3:** `templates_service.py`:

```python
def resolve_tenant_template(code: str, channel: str, locale: str, tenant_id: uuid.UUID):
    """Registered into core.notifications.templates as the override resolver.

    Returns a core.notifications.templates.NotificationTemplate (duck-typed: same
    frozen dataclass shape) or None — None means "fall back to the platform
    default", not "no template exists", so an inactive or missing override is
    silently correct rather than an error.
    """
    from core.notifications.templates import NotificationTemplate

    row = (
        NotificationTemplateOverride.objects.filter(
            tenant_id=tenant_id, code=code, channel=channel, locale=locale, is_active=True
        )
        .first()
    )
    if row is None:
        return None
    return NotificationTemplate(
        code=row.code, channel=row.channel, subject=row.subject, body=row.body,
        variables=frozenset(row.variables),
    )
```

- [ ] **Step 4:** `services.py` — `assert_override_is_valid` (variables ⊆ platform template's declared set — fetch via `core.notifications.templates.registry.get(code, channel)`, refuse if the platform has no such (code, channel) at all), `assert_preference_may_be_saved` (refuses `event_category == EMERGENCY and not is_enabled`), `is_channel_enabled(user_id, category, channel, tenant_id) -> bool` (cache key `f"notif-pref:{tenant_id}:{user_id}"`, one query populating the whole per-user matrix, mirroring `user_scopes`'s cache-per-user shape; invalidated on `NotificationPreference` save via a signal, mirroring `core/rbac/signals.py`).

- [ ] **Step 5:** Migrations: `0001_initial`, `0002_rls_policies.py` with `rls_operations("notification_templates", "notification_preferences")`.

### Task A4: Endpoints, delivery dashboard, §13 reports

**Files:** create `serializers.py`, `filters.py`, `views.py`, `urls.py`, `reports.py`, `tests/{test_reports,test_api,test_cross_tenant}.py`; modify `config/api_v1.py`, `config/settings/base.py`, `openapi.yaml`, `schema.d.ts`, docs.

**Endpoints (§16):** `GET/POST/PATCH /api/v1/notification-templates` · `POST /api/v1/notification-templates/{id}:preview` · `GET/PATCH /api/v1/notification-preferences` · `GET /api/v1/delivery-logs?channel=&status=&notification_id=&created_at__gte=&created_at__lte=`.

- [ ] **Step 1: Failing tests** — `:preview` renders with sample data from `variables` and never persists; `PATCH /notification-preferences` on the `emergency` category with `is_enabled=false` is `422`; `GET /notification-preferences` for a user with no rows returns the full category×channel matrix defaulted `true` (never an empty list — a client must not have to know the "no row = enabled" rule itself); `GET /delivery-logs` is read-only (`POST`/`PATCH`/`DELETE` → 405); cross-tenant `GET /delivery-logs/{id}` → 404.

- [ ] **Step 2:** `views.py` — `NotificationPreferenceViewSet.list` overrides `get_queryset` to return the *materialized* matrix (every `(category, channel)` pair, existing rows overlaid on defaults) rather than a bare queryset — the same "never return fewer rows than the client's mental model expects" reasoning `is_channel_enabled`'s test above states. `DeliveryLogViewSet` is `ListModelMixin` + `RetrieveModelMixin` only (append-adjacent: nothing here should let a caller edit delivery history), `scope_campus_field = None` (no campus dimension), permission `communication.delivery-log.view`.

- [ ] **Step 3:** `reports.py` — `delivery_report(queryset, *, group_by)` (sends by channel/status/provider — §13), taking an already-scoped `DeliveryLog` queryset exactly like `fees_finance/reports.py`'s contract. `assertNumQueries`-proven with the two-cohort-size comparison idiom `fees_finance/tests/test_spend.py` established.

- [ ] **Step 4:** Enum overrides for `ENUM_NAME_OVERRIDES`: none new beyond what `core.notifications.models` already declared (reuse, do not re-declare, `NotificationChannel`/`NotificationCategory`/`DeliveryStatus`).

- [ ] **Step 5:** Docs — `docs/03-modules/communication.md` gains a §20 register (Built / Decisions carried forward / Deliberately not built, the `attendance.md`/`examinations.md`/`fees-finance.md` shape). `docs/project-status.md`'s Tier 4 row updated.

- [ ] **Step 6:** Commit, push, `gh pr checks <n> --watch`.

```
feat(communication): tenant-editable templates, channel preferences, and the delivery dashboard
```

---

# PR B — `feat/communication-announcements-and-notices`

**Deliverable:** staff publish feed-style announcements and formal, sequence-numbered notices through a publish-approval gate, both fanning out through `notify()` with a real per-channel-rendered template, and a notice PDF a guardian can be sent.

**Branch:** off `feat/communication-templates-and-preferences`.

### Task B1: `announcements`

**Files:** extend `models.py`, `services.py`; create `notifications.py`, `documents.py` (announcement-side is template-only, no PDF); `migrations/0003_announcements.py`, `0004_rls_policies.py`; `tests/{test_announcements,test_notifications}.py`.

- [ ] **Step 1: Failing tests**

```python
def test_publishing_resolves_the_audience_to_at_least_one_recipient(self):
    """§11: audience resolution must yield >= 1 recipient — refused otherwise,
    not published-with-zero-reach."""

def test_a_custom_audience_referencing_a_cross_tenant_user_id_is_refused(self):
    """§11's re-validation-against-the-tenant rule — 404-shaped, not 403,
    per the platform's own cross-tenant convention."""

def test_a_scheduled_announcement_publishes_itself_at_publish_at(self):
    ...

def test_an_expired_announcement_is_excluded_from_the_staff_feed(self):
    ...

def test_show_on_website_only_ever_true_for_a_published_announcement(self):
    ...

def test_publish_fans_out_exactly_once_per_resolved_recipient_regardless_of_audience_size(self):
    """assertNumQueries two-cohort-size comparison — the shape
    fees_finance/tests/test_notifications.py and test_spend.py both use."""

def test_the_real_notify_call_persists_a_notification_and_a_delivery_log_per_channel(self):
    """Exercises the REAL notify(), not a mock — the fees-finance review round
    found every mocked-notify() call site in that module had a broken context
    shape that shipped through two review rounds undetected. Do not repeat
    that mistake here: assert on persisted core.notifications rows."""
```

- [ ] **Step 2:** `Announcement(TenantOwnedModel)` per the entities doc — `audience_type`/`audience_filter`/`campus_id` (nullable, `campus_allows_null=True`), `status`, `is_emergency`, `publish_at`, `expires_at`, `show_on_website`, `attachments` (jsonb of `files.id`), `published_by`/`published_at`. Indexes per the doc.

- [ ] **Step 3:** `services.py` — `resolve_audience(*, audience_type, audience_filter, tenant_id) -> list[uuid.UUID]` (role slugs / class / section / house / campus ids / explicit user ids, one query per resolution path, never a query per candidate user), `assert_audience_is_nonempty`, `publish_announcement(*, announcement, actor_id)` (transitions status, sets `published_by/at`, calls `notify("communication.announcement-published", ...)` with **one** call for the whole resolved audience — never per-recipient, per the fees-finance-review-caught anti-pattern).

- [ ] **Step 4:** `notifications.py` registers `communication.announcement-published` in `core.notifications.catalog`, category `general` (or `emergency` when `is_emergency`), channels `{in_app, push}` per §12 — declaring `push` even with no adapter is correct per PR A's Task A1 framing (recorded `skipped`, not silently dropped).

- [ ] **Step 5:** `POST /announcements/{id}:publish`, `GET/POST /announcements`, `PATCH/DELETE /announcements`. `scope_campus_field = "campus_id"`, `campus_allows_null=True`. `communication.announcement.{view,create,update,delete,publish}`.

### Task B2: `notices`

**Files:** extend `models.py`, `services.py`, `notifications.py`; create `documents.py`; `migrations/0005_notices.py`; `tests/test_notices.py`.

- [ ] **Step 1: Failing tests**

```python
def test_notice_numbers_are_gapless_across_a_batch(self):
    """allocate_number inside the same transaction, mirroring
    fees_finance/numbering.py's invoice-number precedent exactly."""

def test_the_approver_cannot_be_the_drafts_own_creator(self):
    """§7's workflow diagram + auth-and-rbac.md §2.4 segregation of duties —
    same rule, same reasoning, as fees_finance's refund approval gate."""

def test_publish_without_prior_approval_is_refused(self): ...

def test_returned_with_comments_goes_back_to_draft_not_to_pending_approval(self): ...

def test_acknowledging_a_notice_that_does_not_require_it_is_refused(self): ...

def test_acknowledging_twice_is_idempotent_not_an_error(self):
    """A guardian double-tapping 'acknowledge' must not 500 — the second call
    is a no-op, tested explicitly rather than assumed."""

def test_the_acknowledgment_progress_count_is_a_bounded_number_of_queries(self):
    """Aggregated in SQL over notifications.acknowledged_at, not a Python loop
    over recipients — the same aging-report discipline fees_finance/reports.py
    documents."""
```

- [ ] **Step 2:** `Notice(TenantOwnedModel)` per the entities doc — `notice_no` (unique per tenant, assigned at publish), `notice_type`, `status` (`draft → pending_approval → published → archived`), `requires_acknowledgment`, `valid_until`, `approved_by` (CHECK-equivalent service assertion: must differ from `created_by`). No `campus_id` column exists on this table per the entity doc — `scope_campus_field = None`, stated explicitly per the Global Constraints rule.

- [ ] **Step 3:** `numbering.py` addition or inline in `services.py`: `allocate_notice_no(*, tenant_id)` reads `TenantSettings.communication["notice_number_pattern"]`, calls `allocate_number(scope="notice_number", series=..., tenant_id=...)` — copies `fees_finance/numbering.py`'s blank-the-`{seq}`-token pattern verbatim.

- [ ] **Step 4:** `documents.py` — `notice_html(notice, recipient_context)` + `core.documents.render_pdf`, same page-size threading fees-finance's receipt used (A4 default; notices have no thermal use case per the module doc, so only one layout ships). `GET /notices/{id}?format=pdf`.

- [ ] **Step 5:** `POST /notices/{id}:submit`, `:publish` (approval-gated), `:acknowledge`. `notifications.py` registers `communication.notice-published` (channels per §12: email/SMS/push/in-app — SMS/push recorded skipped per PR A) and `communication.notice-ack-reminder` (the Celery Beat sweep over non-acknowledgers, `for_each_tenant`, added to `CELERY_BEAT_SCHEDULE`).

- [ ] **Step 6:** Regenerate contract; e2e `communication-notices.spec.ts`; docs; commit; `gh pr checks <n> --watch`.

```
feat(communication): announcements and formal notices with a publish-approval gate
```

---

# PR C — `feat/communication-threads-and-broadcast`

**Deliverable:** guardians and staff message each other in threads scoped to a child or a topic, and an authorized user can hit every channel at once for the whole school in an emergency — the two features that most directly replace "an ad-hoc WhatsApp group."

**Branch:** off `feat/communication-announcements-and-notices`.

### Task C1: `message_threads` and `messages`

**Files:** extend `models.py`, `services.py`, `notifications.py`; `migrations/0006_threads.py`, `0007_rls_policies.py`; `tests/test_threads.py`.

- [ ] **Step 1: Failing tests**

```python
def test_only_a_thread_participant_may_post_a_message(self): ...

def test_a_guardian_thread_must_be_bound_to_one_of_their_own_children(self):
    """student_id set means own-scope narrows through student_guardians, the
    same delegation shape fees_finance's invoice ownership already uses."""

def test_filter_owned_by_user_returns_only_threads_the_caller_participates_in(self):
    """The JSONB __contains lookup — Q(participant_user_ids__contains=[str(user.pk)]),
    proven against the real Postgres role in CI, not sqlite."""

def test_a_reply_bumps_last_message_at_and_reopens_a_closed_thread_is_refused(self):
    """§6: close/reopen exists as an explicit action, not an implicit side
    effect of a new message landing on a closed thread."""

def test_an_internal_note_is_invisible_to_a_guardian_participant(self):
    """§6's is_internal_note recommendation, built here since a thread with
    school-only routing notes mixed into guardian-visible replies is a real
    information leak, not a cosmetic gap."""

def test_a_reply_notifies_every_other_participant_exactly_once(self):
    """communication.thread-reply — one notify() call for the participant set
    minus the sender, never per-participant."""
```

- [ ] **Step 2:** `MessageThread(TenantOwnedModel)` — `subject`, `thread_type`, `student_id` (nullable FK), `participant_user_ids` (jsonb array), `assigned_to`, `status`, `last_message_at`, `closed_at`. `filter_owned_by_user(queryset, user)`:

```python
@staticmethod
def filter_owned_by_user(queryset, user):
    return queryset.filter(participant_user_ids__contains=[str(user.pk)])
```

`Message(TenantOwnedModel)` — `thread` FK, `sender_id`, `body`, `attachments`, `is_internal_note`, `read_by` (jsonb map), `sent_at`. Per the entity doc's stated exception: no `updated_at`/`updated_by` use (immutable after send; `save()` overridden to refuse `update_fields` outside a documented small allow-list mirroring the append-only pattern's shape, though this table keeps normal soft-delete — it is immutable, not append-only, and the entity doc does not ask for a database-level grant here).

- [ ] **Step 3:** `services.py` — `assert_sender_is_participant`, `create_thread` (guardian/student callers: `assert_student_is_own_child` delegating to `Student.filter_owned_by_user`, same delegation `fees_finance`'s invoice ownership uses), `post_message` (bumps `last_message_at`, calls `notify("communication.thread-reply", recipients=participants - {sender}, ...)`), `close_thread`/`reopen_thread` as explicit transitions.

- [ ] **Step 4:** `GET/POST /message-threads`, `POST /message-threads/{id}/messages`, `POST /message-threads/{id}:close`. `scope_campus_field = None` (a thread has no campus column; visibility is participant membership, which is `own` scope via the hook above — stated explicitly per the Global Constraints rule). `communication.thread.create`/`communication.message.create` — `own` scope default for guardian/student, unrestricted create for staff roles per §4.

### Task C2: Emergency broadcast

**Files:** extend `services.py`, `notifications.py`; create `tasks.py`; `tests/test_broadcast.py`.

- [ ] **Step 1: Failing tests**

```python
def test_broadcast_requires_the_broadcast_send_permission_specifically(self):
    """Not announcement.publish — §4 names it as its own key precisely because
    it bypasses the approval gate notices/announcements otherwise have."""

def test_broadcast_ignores_every_recipients_channel_preferences(self):
    """The one deliberate bypass of PR A's own preference-gating hook —
    tested by registering a preference resolver that returns False for every
    channel and asserting the broadcast still queues on all of them."""

def test_broadcast_is_a_202_plus_job_not_a_synchronous_send(self):
    """api-architecture.md §2.7 — thousands of recipients on every channel at
    once is never an inline request/response."""

def test_broadcast_audits_the_sender_audience_size_and_channel_list(self):
    """§7's 'no approval gate by design (speed); mitigated by narrow
    permission and audit' — the audit entry is the actual mitigation, so its
    absence is the actual finding a reviewer would raise."""

def test_a_broadcast_to_zero_recipients_is_refused_before_the_job_is_created(self):
    ...
```

- [ ] **Step 2:** `POST /broadcasts:emergency` → `ActionResponse.accepted` (202 + job), body `{audience_type, audience_filter, campus_id, message, channels}`. `services.dispatch_emergency_broadcast` resolves the audience (reusing `resolve_audience` from Task B1), records an audit entry via `record_audit` before enqueueing, and the Celery task calls `notify("communication.emergency-broadcast", ...)` with the preference resolver's result forced to `True` for this one call — implemented as a `notify(..., bypass_preferences=True)` parameter threaded through PR A's `set_preference_resolver` call site in `core/notifications/services.py` (a small, additive signature change to `notify()`, covered by Task A1's regression test since the default stays `False`).

- [ ] **Step 3:** `notifications.py` registers `communication.emergency-broadcast`, category `emergency`, channels `{in_app, email, sms, push, whatsapp}` — every channel §12 lists, regardless of adapter availability, per PR A's `skipped`-with-reason framing.

- [ ] **Step 4: §20 final doc pass** — `docs/03-modules/communication.md` §20 completed: locale variants, SMS/push/WhatsApp providers, quiet hours/suppression/quotas, the announcement/notice guardian-read-endpoint gap (parent-portal's task), the `message_participants` join-table promotion, birthday trigger (certificates-documents, Tier 7). `docs/05-database/entities/communication.md` reconciled with the two new `DeliveryLog` columns Task A1 added (note them against the `delivery_logs` section, since the entity doc's canonical schema should reflect what shipped). `docs/project-status.md` moves communication to done.

- [ ] **Step 5:** e2e `communication-broadcast.spec.ts` (draft notice → approve → publish → guardian receives an in-app notification, read back through `GET /notifications`); regenerate contract; commit; `gh pr checks <n> --watch`.

```
feat(communication): guardian/staff message threads and emergency broadcast
```

---

## Verification

No local test run, by policy. Verification is CI, in this order:

1. `gh pr checks <n> --watch` — `api.yml` (ruff, mypy, tests on real PostgreSQL 18 with coverage, `makemigrations --check`, the OpenAPI staleness gate, `manage.py check --deploy`), `frontend.yml` (schema freshness), `repo-hygiene.yml` (cspell, Prettier, markdown links, `project-status-sync`).
2. On red: `gh run view <id> --log-failed`, fix, push. Environment-reason failures: `gh run rerun <id> --failed` before concluding anything about the code.
3. **The checks that specifically catch this plan going wrong:**
   - `core/notifications/tests/test_services.py`'s new regression tests — fail if Task A1's hooks change behaviour for a resolver-free caller, which would silently break attendance/fees-finance/examinations.
   - `tests/test_rls_coverage.py` — every one of the 6 new communication tables.
   - `tests/test_endpoint_contracts.py` — every new view's `required_permission` and resolving `scope_campus_field`.
   - `tests/test_rls_enforcement.py` — connects as the real `schoolhub_app` role; the JSONB `filter_owned_by_user` lookup on `message_threads` is exactly the kind of thing that must be proven against real Postgres, not sqlite.
   - Coverage: 85% floor.
4. Trigger the live e2e lane (`.github/workflows/e2e-live.yml`) manually before merging PR C.

## Self-Review

- **Spec coverage.** §4's keys → A (template, notification-preference, delivery-log), B (announcement, notice), C (thread, message, broadcast). §5's seven features → A (6, 7's dashboard half), B (1, 2), C (3, 5); §5.4 (multi-channel notifications) is PR A's `core/` extension, not a standalone feature task. §6 → A (SMS segment counter deferred with SMS itself), B (audience targeting, sequence numbering, PDF), C (participant routing, close/reopen). §7's two workflows → B (notice publication), C (emergency broadcast). §11 → A (variable whitelist, emergency-floor), B (audience non-empty, notice_no unique, approver ≠ creator), C (participant-only posting, own-child binding). §12's seven rows → B (3), C (2); birthday deferred with certificates-documents. §13's four reports → A (delivery/credit-usage groundwork — credit usage itself deferred with SMS), C (engagement, thread SLA deferred as §19 recommendation). §15's 8 tables → 2 already built (`core/notifications`), A (2), B (2), C (2). §16's endpoints → A–C, all present except the guardian-facing announcement/notice read endpoint (recorded gap).
- **Deliberate omissions, each recorded in §20:** locale variants beyond `en`; SMS/push/WhatsApp providers (no `core/integrations`); quiet hours, suppression lists, SMS credit quotas; the guardian-facing announcement/notice browse endpoint (parent-portal's task); `message_participants` join-table promotion; birthday trigger (certificates-documents, Tier 7); §14's three AI capabilities; thread SLA report.
- **Type consistency.** `core.notifications.templates.resolve()` and `core.notifications.services.notify()`'s `bypass_preferences` parameter are each introduced once (Task A1) and consumed unchanged through B and C. `NotificationChannel`/`NotificationCategory`/`DeliveryStatus` are never redeclared outside `core/notifications/models.py` — every communication model imports them. `resolve_audience(*, audience_type, audience_filter, tenant_id)` is defined once in Task B1 and reused verbatim by Task C2's broadcast.
- **Risk worth naming.** Task A1 is this plan's `TenantScopedModel`-extraction equivalent: it changes behaviour inside a function three other modules already call in production. Its regression tests run each existing caller's own fixture unchanged and assert byte-identical output specifically so a mistake here fails loudly in PR A's own CI run rather than surfacing as a silent notification-content regression in attendance or fees-finance weeks later.
