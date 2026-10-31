# Communication PR C/D — Message Threads + Emergency Broadcast (backend + dashboard) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. **Every "Commit" step and every push or PR step happens only after the user's explicit go-ahead.** Every subagent brief carries this repo's overrides (agent-lessons L11): no local tests, lint or typecheck; no AI attribution; never `--no-verify`; CI is the source of truth.

**Work tier:** 2

**Goal:** Finish the `communication` module.
- Guardians and staff message each other in threads only participants can see.
- Principals and owners get an audited, read-only oversight view of every thread.
- An authorized user can send an emergency broadcast that bypasses preferences. It goes out through a preview, then a send that must repeat back the preview's recipient count and audience digest.
- The dashboard gets a Messages inbox and an Emergency Broadcast screen.

**Architecture:**
- **Backend:** new resource packages in `apps/api/apps/communication/` (`threads/`, `oversight/`, `broadcasts/`) in the existing file-per-action layout (`notices/` is the template). `Message` is an `AppendOnlyTenantModel` whose only mutable column is `read_by`.
- **Broadcast send:** a 202 + `BackgroundJob`, wrapped in `core.idempotency.services.replay_or_execute`. The job's Celery task runs on the dedicated `emergency` queue and calls `notify()` under the `emergency` category. On `main`, `notify()` already skips preference gating for that category, so no `notify()` change is needed.
- **Dashboard:** a `communication` module (sidebar group, tab bar, two sections) built on the attendance kit.

**Tech Stack:** Django 6.1 + DRF, Celery, PostgreSQL 18 (RLS, JSONB/GIN, column grants); Next.js 16, TanStack Query, next-intl, `packages/ui`; Jest; Playwright.

**Spec:**
- `docs/03-modules/communication.md` (§4, §5.3, §5.5, §6, §7, §11, §12, §13, §16, §19)
- `docs/05-database/entities/communication.md` (`message_threads`, `messages`)
- `docs/03-modules/parent-portal.md` §7
- `docs/02-architecture/notifications.md` §5 (emergency lane)
- This plan supersedes PR C of `docs/superpowers/plans/2026-09-08-communication-module.md`.

**Lands as:** on approval, this file is copied to `docs/superpowers/plans/2026-10-31-communication-threads-and-broadcast.md`, with its `## Independent review` block, in PR C's first commit. It ships as **two stacked PRs**:
- **PR C:** `feat/communication-threads-and-broadcast`, off `main`. Backend, contract, seed, docs, ADRs and the live e2e spec.
- **PR D:** `feat/communication-dashboard`, off PR C. It needs PR C's regenerated `schema.d.ts`.

---

## Context

`main` has `communication` PR A (#62) and PR B (#64), both merged. `project-status.md:24,37,271` still says "PR B open", which is stale and gets fixed here. PR C is "not yet started" (module doc §20). Once it ships, every dependency of `parent-portal` is done.

These things already exist on `main` and are reused here:
- `notify()`'s EMERGENCY-category preference bypass.
- `audience.resolve_audience` / `assert_audience_is_nonempty`.
- `core.jobs.services.create_job` / `enqueue_job` / `mark_*`.
- `core.idempotency.services.replay_or_execute` (precedent: `apps/fees_finance/views.py:533-560`).
- `TenantAwareTask` + `tenant_atomic`.
- `record_audit`.
- `AppendOnlyTenantModel` + `append_only_operations(mutable_columns=…)` + the raw single-column `UPDATE` precedent (`apps/fees_finance/ledger.py:234-244`).
- `Student.filter_owned_by_user`, `active_enrollment(student)`, `Section.class_teacher_staff_id`.
- The `TenantSettings.communication` namespace.
- `core.rbac.permissions.is_restricted_principal` and `scope_queryset`.
- `STAFF_PERMISSIONS` / `OWN_PREFERENCE_PERMISSIONS`.
- `core.api.exceptions.Conflict` / `DomainRuleViolation`.

User decisions (2026-10-31):
- **Scope:** backend **and** dashboard.
- **Broadcast confirmation:** preview, then a send that repeats back what the preview showed; a mismatch is 409.
- **Thread visibility:** participant-only inbox, **plus** a `communication.thread.oversee` key giving audited, read-only access to every thread.

## Alternatives considered (why not)

| Decision | Chosen | Rejected, and why |
| -------- | ------ | ----------------- |
| Emergency preference bypass | Register the trigger with `category=EMERGENCY` (+ `priority=EMERGENCY`) | `notify(..., bypass_preferences=True)` from the module plan. Core already bypasses on the category, so a second mechanism would be redundant. |
| Broadcast confirmation | `:preview` returns `{recipient_count, audience_digest, channels, unavailable_channels}`. `:emergency` requires `confirm_recipient_count` **and** `audience_digest`; either mismatching gives 409 `audience_changed` | A typed fixed phrase (proves nothing about the audience); UI-only confirmation (a script or stale tab bypasses it); count only (one recipient leaving and one joining keeps the count but changes the audience; the digest closes that). The typed value in the UI is the count, which also covers §11's typed-confirmation recommendation. |
| Who the job sends to | The recipient ids resolved at send time are frozen into the job payload (about 0.6 MB at 15k recipients; `GET /jobs/{id}` never returns `payload`; pruned at 30 days) | Re-resolving inside the worker could send to a different set than the one confirmed. |
| Broadcast queue | `send_emergency_broadcast_task` is routed by explicit name to `emergency` | `bulk`. notifications.md §5 gives emergency its own always-warm lane, and every worker already consumes `emergency`. |
| Channels | Always every channel on the trigger. The preview splits them by adapter availability, so a confirmation never claims SMS when there is no SMS adapter | A `channels` request field. §5.5/§7 say "all channels", and `notify()` has no per-call subset. |
| Broadcast idempotency | `replay_or_execute(endpoint="broadcasts:emergency")`. The dashboard mints a new key whenever the preview result changes | Relying on `create_job(idempotency_key=…)`. It is a plain `create`, so a repeated key raises `IntegrityError` and becomes a generic 409. |
| Thread visibility | Inbox = participant membership only (`filter_owned_by_user` **and** `filter_assigned_to_user` both return the participant filter, so ASSIGNED-scoped class teachers see their routed threads). Restricted principals are also required to still own the thread's student. Separate read-only `/message-thread-oversight` for `thread.oversee` (school_owner, principal), auditing every retrieve and message read | Plain RBAC scope (admins' inboxes fill with other people's conversations, and ASSIGNED scope returns `.none()`); participants only (no safeguarding oversight; the user rejected it). ADR-0030. |
| `messages` immutability | `Message(AppendOnlyTenantModel)`, `MUTABLE_FIELDS={"read_by"}`, `append_only_operations("messages", mutable_columns=["read_by"])`; mark-read is one raw `UPDATE messages SET read_by = jsonb_set(…)` | A `save()` override. `QuerySet.update()` bypasses it, nothing enforces it in the database, and the repo already has the stronger base. Soft delete is deferred (no delete endpoint ships). |
| Participants storage | JSONB `participant_user_ids` + GIN, per the entity doc and §19 | A `message_participants` join table. §19 defers it. |
| Guardian thread routing | The class teacher of the student's active section. Otherwise active users holding `TenantSettings.communication["thread_fallback_role"]` (default constant `THREAD_FALLBACK_ROLE_DEFAULT = "school_admin"`; an unknown slug falls back to the default and logs a warning) | A hard-coded office role. parent-portal §7 says "configured role". |
| Picking internal-thread participants | A communication-owned `GET /message-threads/recipients?search=` (key `thread.create`) returning active, non-restricted users as `{user_id, name, role}` | The staff directory. `staff.staff.view` is record-scoped and `Staff.user_id` is nullable, so an own-scoped teacher would see nobody. |
| Thread list paging | Cursor on `("-last_message_at", "-id")` with `last_message_at` NOT NULL (always set at create) | The nullable column the entity doc allows. DRF cursor paging needs a non-null, near-unique ordering. |
| Message paging | Newest first, reversed in the UI (Slack `conversations.history` style) | Oldest first, which opens a long thread at its first page. |
| Duplicate `assert_file_usable` | Move it once to `core/files/services.py` (ADR-0013 allows imports from `core.files`), using `FileStatus.READY`. Repoint **every** importer: staff (5 internal), student, and `apps/attendance/services.py:50` | A fourth importer of `student_management.services`. |
| Cursor-list hooks | Move `use-cursor-list.ts` / `use-cursor-stack.ts` from `features/attendance/` to `src/hooks/` | A cross-feature import, or a copy. |

## Global Constraints

- **Invariants** (AGENTS.md):
  - #1: both new tables are tenant-owned with RLS.
  - #2: cross-tenant and own-scope misses return **404**.
  - #3: every endpoint declares a `communication.*` key.
  - #6: `openapi.yaml` + `schema.d.ts` are regenerated by the generators in **every** commit that changes the API.
  - #7: no cookie- or HTML-only flow.
- **Thread and message spec values:**
  - `thread_type` ∈ `guardian_school|internal|group`.
  - `status` ∈ `open|closed`.
  - `subject` ≤ 200.
  - Indexes: `(tenant_id, status, last_message_at DESC)`, `(tenant_id, student_id)`, GIN `(participant_user_ids)`, `(tenant_id, thread_id, sent_at)`.
- **Triggers:**
  - `communication.thread-reply`: category `general`, channels `{in_app, push}`, push template **has a subject**.
  - `communication.emergency-broadcast`: category `emergency`, `priority=EMERGENCY`, channels `{in_app, email, sms, push, whatsapp}`. SMS/WhatsApp subjectless; in-app/email/push with subject.
- **Keys:**
  - Existing: `thread.create`, `message.create` (THREAD_PARTICIPANTS); `broadcast.send` (BROADCAST_SENDERS).
  - Gap-fills (documented in `permissions.py` and the §4 table):
    - `communication.thread.view` (THREAD_PARTICIPANTS)
    - `communication.thread.close` (THREAD_PARTICIPANTS minus guardian/student)
    - `communication.thread.oversee` (`school_owner`, `principal`)
- **Named constants:**
  - `THREAD_FALLBACK_ROLE_DEFAULT`, `BROADCAST_MESSAGE_MAX_LENGTH = 1000`.
  - Thread attachments use `10 * MEGABYTE` (from `core/files/purposes.py`).
- **Repo rules:**
  - Conventional Commits; no AI attribution; `fix` commits carry `Root cause:`.
  - Theme-token colors only.
  - i18n keys in both `en.json` and `ur.json`.
  - Docs change in the same PR.
  - A `noqa: BLE001` on the task's catch-all cites its precedent, `apps/staff_management/tasks.py:72,90`.

## Review Focus

1. **A class teacher with ASSIGNED scope (the production default) is routed a guardian thread.** They must list, open and reply to it (`test_assigned_scope_class_teacher_sees_and_replies`, C2/C3).
2. **A guardian's portal access is revoked after a thread exists.** The thread must 404 for them on list, retrieve and post (`test_revoked_guardian_loses_thread`, C2).
3. **The audience changes between preview and send, at the same count.** Send must be 409 `audience_changed` with `meta.recipient_count` and must create no job (`test_same_count_different_audience_is_409`, C4).
4. **A double-clicked send.** The same `Idempotency-Key` replays the first 202 with the same `job_id`, and there is one fan-out (`test_same_idempotency_key_replays_same_job`, C4).
5. **A guardian gets a staff internal note.** It must not appear in their message list, and they must not be notified of it (`test_internal_note_hidden_from_and_not_notified_to_guardian`, C3).

---

# PR C — backend (`feat/communication-threads-and-broadcast`)

### Task C1: Models, migrations, shared file helper, uploads

**Files:**
- Modify: `apps/api/apps/communication/models.py`.
- Create: `migrations/0006_message_threads.py`, `0007_rls_and_grants.py`; `threads/__init__.py`, `threads/tests/{__init__,test_models}.py`; `apps/communication/uploads.py`.
- Create or modify: `apps/api/core/files/services.py`.
- Modify every `assert_file_usable` importer: `apps/staff_management/**`, `apps/student_management/services.py`, `apps/attendance/services.py`. Find them with `git grep assert_file_usable`.

**Interfaces:**
- **`MessageThread(TenantOwnedModel)`:**
  - Fields: `subject`, `thread_type` (`ThreadType`), `student` (FK `student_management.Student`, null, `PROTECT`), `participant_user_ids` (JSONField list[str]), `assigned_to_id` (UUID null), `status` (`ThreadStatus`), `last_message_at` (**NOT NULL**), `closed_at`.
  - `@classmethod participant_filter(cls, queryset, user)` returns `queryset.filter(participant_user_ids__contains=[str(user.pk)])`. Both `filter_owned_by_user` and `filter_assigned_to_user` delegate to it.
  - `is_participant(user_id) -> bool`.
- **`Message(AppendOnlyTenantModel)`:**
  - `MUTABLE_FIELDS = {"read_by"}`.
  - Fields: `thread` FK (`related_name="messages"`), `sender_id`, `body`, `attachments` (JSON null), `is_internal_note`, `read_by` (JSON null), `sent_at` (default `timezone.now`).
  - No `updated_*` columns, matching the entity doc. No soft delete; recorded as deferred.
- **`0007`:** `rls_operations("message_threads", "messages")` + `append_only_operations("messages", mutable_columns=["read_by"])`.
- **`core.files.services.assert_file_usable(*, file, purpose: str) -> File`**, using `FileStatus.READY`.
- **Upload purpose `communication.thread-attachment`:** pdf/png/jpeg, `max_size_bytes=10 * MEGABYTE`.

- [ ] **Step 1: Failing tests:**
  - `test_participant_filter_returns_only_participant_threads`
  - `test_message_body_update_is_refused` (the base raises)
  - `test_message_queryset_update_is_refused`
  - RLS and append-only coverage are picked up automatically by `tests/test_rls_coverage.py` / `tests/test_append_only_coverage.py`, so they fail until `0007` exists.
- [ ] **Step 2:** Implement the models and migrations. Move `assert_file_usable` and repoint every importer; the existing staff, student and attendance tests cover the move.
- [ ] **Step 3: Commit** (on go-ahead): `feat(communication): message thread and append-only message models with RLS`.

### Task C2: Threads — create, inbox, close/reopen, recipients lookup

**Files:**
- Create: `threads/{serializers,filters,viewset,urls,routing}.py`, `threads/services/{create,close,reopen}.py`, `threads/tests/{test_create,test_endpoints}.py`, `apps/communication/tests/test_cross_tenant.py`.
- Modify: `communication/urls.py`, `permissions.py` (three gap-fill keys), `tests/base.py` (`ALL_KEYS`), `apps/api/openapi.yaml` + `packages/api-client/src/schema.d.ts` (regenerated).

**Interfaces:**
- **`routing.route_guardian_thread(*, student, tenant_id) -> tuple[list[uuid.UUID], uuid.UUID | None]`:**
  - Class teacher: `active_enrollment(student).section.class_teacher_staff_id` → `Staff.user_id` (it must be an active user). Returns that user as `assigned_to`.
  - Otherwise: active users holding the configured fallback role, with `assigned_to=None`.
  - Empty → `DomainRuleViolation` 422 `"No staff member can receive this thread."`
- **`services.create.create_thread(*, actor, tenant_id, subject, thread_type, student_id, participant_user_ids, body, attachments) -> MessageThread`:** creates the thread and its first message (via C3's `post_message`) in one transaction.
- **Create rules:**
  - **Restricted principal** (`is_restricted_principal`): only `guardian_school` (anything else → 422). `student_id` is required and must be in `Student.filter_owned_by_user(Student.objects.alive(), actor)`, else **404**. Participants = actor + routed staff.
  - **Staff, `guardian_school`:** the student must be in `scope_queryset(Student.objects.alive(), actor, …)`, else **404**. Participants = actor + users of guardians with `has_portal_access=True` **and** `receives_communications=True`; zero → 422.
  - **Staff, `internal`/`group`:** every `participant_user_ids` entry must be an active, non-restricted user of this tenant, else **404** for the whole request. `internal` = exactly one other user; `group` = at least two others.
- **Close and reopen:** `close_thread(*, thread, actor)` / `reopen_thread(...)`. Closing a closed thread, or reopening an open one → `Conflict` 409. The actor must be a non-restricted participant.
- **`MessageThreadViewSet`** (list/create/retrieve + actions):
  - `permission_classes = OWN_PREFERENCE_PERMISSIONS`; `required_feature = FEATURE`; `scope_campus_field = None`.
  - `required_permission = "communication.thread.view"`; map `{create: thread.create, close: thread.close, reopen: thread.close, recipients: thread.create}`.
  - **`get_queryset()` does not call `scope_queryset`.** It returns `MessageThread.participant_filter(MessageThread.objects.alive(), user)`; for restricted principals it is further narrowed to `student__in=Student.filter_owned_by_user(...)`. The docstring states why: membership *is* the authorization (ADR-0030).
  - Each row carries `unread_count`: one annotated `Count` of messages not sent by the caller and without the caller's key in `read_by`, excluding internal notes for restricted principals.
- **Endpoints:**
  - `GET/POST /message-threads`: cursor `("-last_message_at", "-id")`; filters `status`, `thread_type`, `student_id`.
  - `GET /message-threads/{id}`.
  - `POST /message-threads/{id}:close`, `:reopen`.
  - `GET /message-threads/recipients?search=`: active non-restricted users, `{user_id, name, role}`, capped page size.

- [ ] **Step 1: Failing tests:**
  - `test_guardian_thread_routes_to_class_teacher_and_assigns_them`
  - `test_guardian_thread_falls_back_to_configured_role`
  - `test_unknown_fallback_role_uses_default`
  - `test_no_routable_staff_is_422`
  - `test_guardian_thread_for_unlinked_student_is_404`
  - `test_guardian_cannot_create_internal_thread_422`
  - `test_revoked_guardian_loses_thread`
  - `test_staff_guardian_thread_out_of_scope_student_is_404`
  - `test_staff_guardian_thread_skips_guardians_without_portal_or_comms`
  - `test_internal_thread_with_foreign_tenant_user_is_404`
  - `test_assigned_scope_class_teacher_sees_and_replies`
  - `test_list_shows_only_participant_threads_even_for_scope_all_admin`
  - `test_retrieve_non_participant_is_404`
  - `test_unread_count_excludes_own_messages`
  - `test_guardian_cannot_close_thread`
  - `test_close_twice_is_409`
  - `test_reopen_closed_thread`
  - `test_recipients_excludes_guardians_and_students`
  - `test_cross_tenant.py`: list leakage, retrieve, close, reopen, recipients, and create with a foreign student or participant → 404.
- [ ] **Step 2:** Implement. Actions follow `notices/viewset.py`: `get_object()` → service → `record_audit(request, "<action>", obj, before=, after=)` → `ActionResponse.ok`. Colon routes are explicit `path()`s ahead of the router. Regenerate the contract.
- [ ] **Step 3: Commit** (on go-ahead): `feat(communication): participant-scoped message threads with guardian routing`.

### Task C3: Messages — list, post, mark-read, reply notification

**Files:**
- Create: `threads/services/{post_message,mark_read}.py`, `threads/tests/test_messages.py`.
- Extend: the `threads` serializers, viewset and urls; `notifications.py`; `test_cross_tenant.py`.
- Regenerate the contract.

**Interfaces:**
- **`post_message(*, thread, sender, body, attachments, is_internal_note) -> Message`:**
  - A non-participant sender → 404.
  - A `closed` thread → `Conflict` 409 `"Reopen the thread to reply."`
  - A restricted principal posting an internal note → 422.
  - Attachments are checked with `core.files.services.assert_file_usable(purpose="communication.thread-attachment")`.
  - Sets `thread.last_message_at = message.sent_at`.
  - Makes one `notify(THREAD_REPLY, recipients=participants − sender (− restricted principals when internal), context={"thread.subject", "message.sender_name", "message.preview"}, source_type="message_thread", source_id=thread.pk)`, skipped when there are no recipients.
- **`mark_thread_read(*, thread, user) -> int`:** one raw `UPDATE messages SET read_by = jsonb_set(COALESCE(read_by, '{}'::jsonb), %s, to_jsonb(now())) WHERE thread_id = %s AND sender_id <> %s AND NOT (COALESCE(read_by,'{}'::jsonb) ? %s) [AND is_internal_note = false for restricted]`, named after `ledger.py:234-244`. It touches only the granted `read_by` column, and RLS applies. Returns the rowcount.
- **Endpoints:**
  - `GET /message-threads/{id}/messages`: cursor `("-sent_at", "-id")`; internal notes filtered out for restricted principals.
  - `POST /message-threads/{id}/messages`: key `message.create`; returns 201.
  - `POST /message-threads/{id}:mark-read`: key `thread.view`; returns `{marked: n}`.
- **`THREAD_REPLY`** is registered in `notifications.py` with in-app and push templates (push has a subject).

- [ ] **Step 1: Failing tests:**
  - `test_non_participant_post_is_404`
  - `test_reply_on_closed_thread_is_409`
  - `test_reply_bumps_last_message_at`
  - `test_reply_notifies_other_participants_once`
  - `test_internal_note_hidden_from_and_not_notified_to_guardian`
  - `test_guardian_cannot_post_internal_note`
  - `test_attachment_with_wrong_purpose_is_422`
  - `test_mark_read_sets_read_by_and_zeroes_unread_count`
  - `test_mark_read_is_idempotent`
  - `test_list_messages_query_count_is_constant` (3 vs 30 messages)
  - Cross-tenant: messages list, post and mark-read → 404.
- [ ] **Step 2:** Implement and regenerate the contract.
- [ ] **Step 3: Commit** (on go-ahead): `feat(communication): thread messages, read receipts and reply notifications`.

### Task C4: Thread oversight (read-only, audited)

**Files:**
- Create: `oversight/{__init__,serializers,viewset,urls}.py`, `oversight/tests/test_oversight.py`.
- Modify: `communication/urls.py`, `test_cross_tenant.py`.
- Regenerate the contract.

**Interfaces:**
- **`ThreadOversightViewSet`** (`STAFF_PERMISSIONS`, key `communication.thread.oversee` for every action, `scope_campus_field=None`, read-only):
  - `GET /message-thread-oversight`: every alive thread in the tenant. Filters `status`, `thread_type`, `student_id`, `assigned_to`. Cursor as in C2.
  - `GET /message-thread-oversight/{id}`: `record_audit(request, "oversight_view", thread)`.
  - `GET /message-thread-oversight/{id}/messages`: includes internal notes; `record_audit(request, "oversight_view_messages", thread)`.
  - It never marks anything read and is never a participant.

- [ ] **Step 1: Failing tests:**
  - `test_principal_lists_all_threads`
  - `test_teacher_without_oversee_is_403`
  - `test_guardian_is_403` (restricted principal)
  - `test_oversight_retrieve_writes_audit_row`
  - `test_oversight_does_not_change_read_by`
  - Cross-tenant: oversight retrieve → 404.
- [ ] **Step 2:** Implement and regenerate the contract.
- [ ] **Step 3: Commit** (on go-ahead): `feat(communication): audited read-only thread oversight`.

### Task C5: Emergency broadcast — preview, send, job

**Files:**
- Create: `broadcasts/{__init__,serializers,viewset,urls}.py`, `broadcasts/services/{preview,dispatch}.py`, `broadcasts/tests/{test_preview,test_dispatch,test_task}.py`, `apps/communication/tasks.py`.
- Modify: `notifications.py`; `communication/urls.py`; `core/api/exceptions.py` only if a `meta`-carrying `Conflict` subclass needs a base hook (otherwise `AudienceChanged` lives in `broadcasts/`); `config/settings/base.py` `CELERY_TASK_ROUTES`: `"apps.communication.tasks.send_emergency_broadcast_task": {"queue": "emergency"}`; `core/notifications/adapters.py` (add `available_channels() -> set[str]` if no equivalent exists).
- Regenerate the contract.

**Interfaces:**
- **`BroadcastRequestSerializer`:** `audience_type`, `audience_filter`, `campus_id` (optional), `message` (1..`BROADCAST_MESSAGE_MAX_LENGTH`). Every id in `audience_filter` (`class_ids`, `section_ids`, `house_ids`, `campus_ids`, `user_ids`) and `campus_id` must belong to the tenant, else **404** (§11).
- **`BroadcastSendSerializer`:** adds `confirm_recipient_count: int ≥ 1` and `audience_digest: str`.
- **`preview_broadcast(*, tenant_id, audience_type, audience_filter, campus_id) -> dict`** returns `{"recipient_count", "audience_digest", "channels", "unavailable_channels"}`:
  - `audience_digest` = sha256 hex of the sorted recipient ids joined by `,`.
  - `channels` = the trigger's channels ∩ `available_channels()`; `unavailable_channels` = the rest.
  - An empty audience → 422.
- **`AudienceChanged(Conflict)`:** `default_code = "audience_changed"`, `meta={"recipient_count": n, "audience_digest": d}` (the envelope carries structured data only in `meta`).
- **`dispatch_emergency_broadcast(*, request, data) -> BackgroundJob`:**
  - Resolve the audience; a count **or** digest mismatch raises `AudienceChanged`.
  - `create_job(job_type="communication.emergency-broadcast", payload={"recipient_ids", "message", "audience_type", "audience_filter", "campus_id"}, actor_id=…)`.
  - `record_audit(request, "broadcast", job, after={recipient_count, channels, unavailable_channels, audience_type, audience_filter, campus_id, message})`.
  - `enqueue_job(job=job, task=send_emergency_broadcast_task)`.
- **The viewset `emergency` action** wraps the dispatch in `replay_or_execute(endpoint="broadcasts:emergency", …)` as `fees_finance/views.py:533-560` does. A 409 raised inside is not stored, so a retry re-evaluates.
- **`send_emergency_broadcast_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None`** (`@shared_task(base=TenantAwareTask, bind=True)`):
  - Inside `tenant_atomic`: `notify(EMERGENCY_BROADCAST, recipients=[Recipient(...)], context={"broadcast.message": …}, source_type="emergency_broadcast", source_id=job.pk)`.
  - Then `mark_succeeded(result={"recipient_count", "notification_count"})`; on exception, `mark_failed`.
- **Endpoints** (`BroadcastViewSet`, `STAFF_PERMISSIONS`, key `broadcast.send`):
  - `POST /broadcasts:preview` → 200.
  - `POST /broadcasts:emergency` → `ActionResponse.accepted(str(job.pk), "Emergency broadcast queued.")`.

- [ ] **Step 1: Failing tests:**
  - `test_preview_returns_count_digest_and_splits_unavailable_channels` (in_app/email available; sms/push/whatsapp unavailable)
  - `test_preview_empty_audience_is_422`
  - `test_foreign_class_id_is_404`
  - `test_send_requires_broadcast_send_key` (`announcement.publish` only → 403)
  - `test_guardian_cannot_broadcast`
  - `test_send_is_202_with_job`
  - `test_stale_count_is_409_and_creates_no_job`
  - `test_same_count_different_audience_is_409` (asserts `error.meta.recipient_count`)
  - `test_send_audits_message_and_channels`
  - `test_same_idempotency_key_replays_same_job`
  - `test_enqueue_is_sent_on_commit` (`assert_sent_on_commit`, L26)
  - `test_task_routed_to_emergency_queue`
  - `test_task_sends_to_frozen_recipients`
  - `test_task_ignores_preferences` (disabled email preference → email delivery log still `queued`)
  - `test_task_failure_marks_job_failed`
  - Cross-tenant: preview and send with foreign targeting ids → 404.
- [ ] **Step 2:** Implement and regenerate the contract.
- [ ] **Step 3: Commit** (on go-ahead): `feat(communication): emergency broadcast with digest-confirmed send on the emergency lane`.

### Task C6: E2E seed, live spec, docs, ADRs, PR

**Files:**
- Modify: `apps/api/core/rbac/management/commands/seed_e2e_data.py` and its `test_seed_e2e_data` assertions:
  - A guardian user with `StudentGuardian(has_portal_access=True, receives_communications=True)` to a seeded student.
  - A `Staff` row with `user_id` set as that section's `class_teacher_staff_id`.
  - `module.communication` enabled on both tenants.
  - Communication keys + `platform.job.view` granted to the principal/admin seed roles.
- Create: `e2e/tests/live/api/communication-threads-broadcast.spec.ts`.
- Docs:
  - `docs/03-modules/communication.md`: §4 table adds `thread.view`, `thread.close`, `thread.oversee`; §16 adds messages list, `:mark-read`, `:reopen`, `/recipients`, oversight, `:preview`; §20 gets "Built (PR C)".
  - `docs/05-database/entities/communication.md`: messages are append-only with `read_by` mutable, `last_message_at` is NOT NULL, soft delete is deferred.
  - `docs/project-status.md`: fix the stale PR B lines; communication backend done; start-here → PR D, then parent-portal.
  - `docs/deferred-work.md`: per-broadcast live delivery board; MFA step-up; quiet hours; read-receipt tenant toggle; message soft delete; `message_participants` promotion; §10 webhook events; AI-COM-03; chunked broadcast fan-out against the "seconds" target; parent-portal §7 topic category; thread SLA report; campus-narrowed oversight.
  - `docs/decisions/0029-emergency-broadcast-preview-and-digest-confirmation.md`, stating the remaining limit: the digest proves the recipient set, not that a human read it.
  - `docs/decisions/0030-message-thread-visibility-and-oversight.md`.
  - The ADR README index.

- [ ] **Step 1:** Write the live spec. Model it on `attendance-staff-reports.spec.ts` (job polling) and `students-record-scope.spec.ts`, and follow `e2e/AGENTS.md`'s login-throttle rule (each identity logs in once per spec). It covers:
  - The guardian creates a thread about their child.
  - The ASSIGNED-scope class teacher lists it and replies.
  - The guardian's `GET /notifications` shows a `thread-reply`.
  - The principal reads it through oversight.
  - Admin preview → send with count and digest → `/jobs/{id}` reaches `succeeded` → the guardian's `/notifications` contains the broadcast.
  - A tampered digest → 409.
  - The other tenant's admin gets 404 on the thread.
- [ ] **Step 2:** Write the docs and ADRs.
- [ ] **Step 3: Commits** (on go-ahead): `test(e2e): seed and live journeys for communication threads and broadcast`; `docs(communication): PR C status, ADR-0029, ADR-0030, deferred work`.
- [ ] **Step 4:** `change-reviewer` with this plan → fix → on go-ahead push and `gh pr create --base main --assignee @me --label "needs review"` (body with an ELI5 section) → `gh pr checks <n> --watch` → manually dispatch `e2e-live.yml` on the branch and cite the run.

---

# PR D — dashboard (`feat/communication-dashboard`, stacked on PR C)

Load `schoolhub-dashboard-screen`, `schoolhub-api-services` and `schoolhub-testing` first.

### Task D1: Services, routes, navigation, shared hooks

**Files:**
- Move `features/attendance/use-cursor-list.ts` and `use-cursor-stack.ts` → `src/hooks/` (repoint attendance imports and tests).
- Create `src/services/modules/{message-threads,thread-oversight,broadcasts}/` (the ADR-0019 file set + `index.ts` + `__tests__/`).
- Modify:
  - `src/services/endpoints.ts`
  - `src/services/index.ts` (`Services.messageThreads`, `Services.threadOversight`, `Services.broadcasts`)
  - `src/config/paths.ts` (`COMMUNICATION`, `COMMUNICATION_MESSAGES`, `COMMUNICATION_OVERSIGHT`, `COMMUNICATION_BROADCAST`)
  - `src/config/menu-config.ts`
- Create `features/communication/communication-sections.ts` and `src/app/(app)/communication/{layout,page,messages/page,oversight/page,broadcast/page}.tsx`.
- Modify `messages/en.json` and `ur.json` (`communication` namespace).

**Interfaces:**
- **`MessageThreadsService`:** `listThreads`, `fetchThread`, `createThread`, `listMessages`, `postMessage`, `markRead`, `closeThread`, `reopenThread`, `searchRecipients`.
- **`ThreadOversightService`:** `listThreads`, `fetchThread`, `listMessages`.
- **`BroadcastsService`:** `preview(body) -> BroadcastPreview`, `send(body, idempotencyKey: string) -> JobAccepted`.
- All types are `ApiSchemas[...]` aliases.
- **Sections:** `messages` (`thread.view`), `oversight` (`thread.oversee`), `broadcast` (`broadcast.send`). Sidebar entry: `{ title: "Communication", icon: MessagesSquare, module: "communication", children: sectionMenuItems(COMMUNICATION_SECTIONS) }`.

- [ ] **Step 1:** Service tests first: each call hits its `endpoints.*` path and method, and `send` sets the `Idempotency-Key` header.
- [ ] **Step 2:** Implement, move the hooks, wire the routes. **Commit** (on go-ahead): `feat(dashboard): communication services, routes and navigation`.

### Task D2: Messages inbox and oversight view

**Files:** `features/communication/messages/`: `messages-screen.tsx`, `thread-list.tsx`, `thread-view.tsx`, `message-list.tsx`, `reply-composer.tsx`, `new-thread-dialog.tsx`, `new-thread-form-schema.ts`, `recipient-picker.tsx`, `student-picker.tsx`, `thread-status-badge.tsx`, `__tests__/`. Also `features/communication/oversight/oversight-screen.tsx` (reuses `thread-list`/`thread-view` in a `readOnly` mode) + `__tests__/`.

**Behaviour:**
- **Inbox layout:** two panes. `?thread=<id>` and the status filter live in the URL (`useDataGridUrlState`). The thread list uses `useCursorList`, with an `unread_count` badge.
- **Message list:** pages newest-first and renders reversed, with "Load earlier".
- **Opening a thread:** calls `markRead` once, then invalidates `queryKeys.module("communication")`.
- **Composer:** an "Internal note" checkbox. A closed thread disables send and shows Reopen (gated on `thread.close`).
- **New thread:**
  - Type select.
  - `recipient-picker` searches `searchRecipients` (Popover + Input + list; no new primitive).
  - `student-picker` reuses an existing student search under `features/students` if one exists; otherwise Popover + Input over `Services.students` list `?search=`.
- **Oversight view:** read-only. No composer, no mark-read, internal notes shown with a badge. A banner says views are audited.
- **Styling:** theme tokens only; errors render through the existing error-alert component.

- [ ] **Step 1: Failing Jest tests:**
  - `selects thread from URL and marks it read once`
  - `renders messages oldest-to-newest from newest-first pages`
  - `closed thread disables send and shows reopen for permitted user`
  - `posts internal note flag`
  - `group thread requires two participants`
  - `oversight view never calls markRead and shows audit banner`
  - `thread 404 renders not-found state`
- [ ] **Step 2:** Implement. **Commit** (on go-ahead): `feat(dashboard): communication inbox and thread oversight`.

### Task D3: Emergency Broadcast screen

**Files:** `features/communication/broadcast/`: `broadcast-screen.tsx`, `audience-step.tsx`, `message-step.tsx`, `confirm-step.tsx`, `broadcast-job-panel.tsx`, `broadcast-form-schema.ts`, `__tests__/`.

**Behaviour:** a `Stepper` with four steps.
1. **Audience:** `RadioGroup` (all, staff, students, guardians, class, section) + campus `FilterSelect` + checkbox lists of classes (`useClasses`) and sections (`useSections`).
2. **Message:** `Textarea` with a counter capped at the API's limit.
3. **Confirm:**
   - Calls `preview` and shows the recipient count, the deliverable channel badges, and the unavailable channels muted as "not delivered — no provider".
   - The user must type the exact count to enable **Send emergency broadcast** (destructive variant).
   - The idempotency key is minted per preview result and reused on retry.
   - A 409 `audience_changed` shows `meta.recipient_count`, clears the typed value, re-previews, and stays on this step.
4. **Status:** `useJobPolling("communication", jobId)`, following `ReportJobPanel`.

- [ ] **Step 1: Failing Jest tests:**
  - `send disabled until typed count matches preview`
  - `unavailable channels render as not delivered`
  - `409 audience_changed re-previews and clears confirmation`
  - `retry reuses the same idempotency key; a new preview mints a new one`
  - `class audience requires at least one class`
  - `job panel shows succeeded result`
- [ ] **Step 2:** Implement. **Commit** (on go-ahead): `feat(dashboard): emergency broadcast screen`.

### Task D4: Mocked e2e, docs, PR

**Files:**
- `e2e/src/mocks/domains/communication.ts` (+ `-store.ts`), with fixtures matching the real server shapes (including `error.meta` on 409, L5) and `jobsModule` for the job.
- `e2e/src/pages/dashboard/communication/{messages,oversight,broadcast}.page.ts`, registered in `e2e/src/pages/index.ts` and `e2e/src/fixtures/index.ts`.
- `e2e/src/data/factories.ts`: `COMMUNICATION_PERMISSIONS`.
- `e2e/tests/dashboard/communication-{messages,broadcast}.spec.ts`.
- Docs: communication.md §20 (dashboard built); `project-status.md` (communication full-stack complete; next: parent-portal).

- [ ] **Step 1:** Specs:
  - **Messages:** open a thread → reply → the reply appears; close → send disabled.
  - **Oversight:** read-only.
  - **Broadcast:** preview 42 → type 42 → send → succeeded; the mocked 409 path; a user without `broadcast.send` sees no Broadcast tab.
- [ ] **Step 2:** Docs. **Commits** (on go-ahead).
- [ ] **Step 3:** `change-reviewer` → on go-ahead push and `gh pr create --base feat/communication-threads-and-broadcast --assignee @me --label "needs review"` (with ELI5) → `gh pr checks <n> --watch`.

---

## Verification

- **CI only**, no local runs:
  - `api.yml`: ruff, mypy, Postgres tests including auto-enrolled `test_rls_coverage`, `test_append_only_coverage`, `test_endpoint_contracts`, `test_celery_routing`, and the OpenAPI staleness gate.
  - `frontend.yml`: schema freshness, lint, typecheck, Jest with the 85% ratchet, build, the mocked Playwright `dashboard` project.
  - `repo-hygiene`: links, cspell, doc-sync, the plan-review block.
- **Live:** dispatch `e2e-live.yml` manually on PR C's branch and cite the run in the PR.
- **Manual smoke** (the human's call, after merge, on the compose stack):
  - The guardian and the class teacher exchange messages.
  - The principal opens oversight and an audit row appears.
  - The principal previews and sends a broadcast. Mailpit receives one email per recipient with an address, and the job's `notification_count` equals the preview's count.

## Self-Review

- **Spec coverage:**
  - §4: all keys used, three gap-fills documented in the §4 table.
  - §5.3 → C2/C3/D2; §5.5 → C5/D3.
  - §6 threads: child binding, routing, close/reopen, internal notes.
  - §7 broadcast: confirmation, all channels, audit with the message. The live board is deferred.
  - §11: own-child (404), participant-only posting, broadcast key and confirmation, targeting ids → 404.
  - §12: thread-reply and emergency-broadcast.
  - §13: owner/principal oversight (C4); the SLA report is deferred.
  - §16: every endpoint, plus documented additions.
  - Entity specs (C1).
- **Review findings:** every finding in the independent review is addressed above. The open questions were resolved: oversight by the user; unavailable channels shown as "not delivered"; message soft delete deferred; digest added; a communication-owned recipients endpoint.
- **Type consistency:**
  - Backend names are each defined once and consumed by name: `participant_filter`, `route_guardian_thread`, `create_thread`, `post_message`, `mark_thread_read`, `preview_broadcast`, `dispatch_emergency_broadcast`, `send_emergency_broadcast_task`, `AudienceChanged`, `THREAD_REPLY`, `EMERGENCY_BROADCAST`.
  - Dashboard `Services.*` names match D1.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-10-31
- **Verdict:** REVISE. The approach is right, but four premises are false on main:
  - ASSIGNED-scope teachers get an empty inbox.
  - `create_job` does not dedupe (use `replay_or_execute`).
  - The broadcast must use the `emergency` queue.
  - The preview lists SMS/push/WhatsApp, which have no adapter.
- **Findings addressed:**
  - All four High findings.
  - Medium:
    - `Message` is now `AppendOnlyTenantModel` + raw `read_by` UPDATE.
    - `AudienceChanged` carries `meta`.
    - The push template has a subject; the trigger has emergency priority.
    - The audit records the message.
    - A revoked guardian loses the thread.
    - Staff guardian threads respect the student's scope.
    - `test_cross_tenant.py` + targeting-id 404s.
    - Explicit seed work.
    - The contract is regenerated in every API commit.
    - Communication-owned recipients endpoint.
    - Non-null cursor ordering; messages paged newest-first.
    - ADR-0030 + §4 table + topic category deferred.
    - Commit/push only on go-ahead, L11 briefs.
  - Low:
    - Every `assert_file_usable` importer named, `FileStatus.READY`.
    - Payload size accepted; chunked fan-out deferred.
    - Audience digest added and its limit stated in ADR-0029.
    - `assert_sent_on_commit` test; `noqa` precedent cited.
    - Named constants.
    - One restricted-principal behaviour (422).
    - Fallback-role slug handled.
    - `receives_communications` respected.
- **Unresolved:** none. The user chose an oversight key (2026-10-31). Unavailable channels are shown as "not delivered". Message soft delete is deferred. A digest was added to the confirmation. A recipients endpoint was added.
