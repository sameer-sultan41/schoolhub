# 0030. A thread is visible to its participants; anyone else reads it only through audited oversight

- **Status:** Accepted
- **Date:** 2026-11-01
- **Enforced by:** `apps/api/apps/communication/threads/tests/test_endpoints.py` (`test_assigned_scope_class_teacher_sees_routed_thread`, `test_assigned_scope_class_teacher_replies`, `test_revoked_guardian_loses_thread_on_list_and_retrieve`, `test_revoked_guardian_cannot_post`) and `test_messages.py` (`test_internal_note_hidden_from_and_not_notified_to_guardian`) (an `assigned`-scope class teacher sees and answers a routed thread; a scope-`all` admin who is no participant gets 404; a guardian whose portal access is revoked loses the thread on list, retrieve and post; an internal note is neither shown nor notified to a guardian), `apps/api/apps/communication/oversight/tests/test_oversight.py` (every retrieve and messages read writes an audit row, nothing stamps `read_by`), `apps/api/apps/communication/threads/tests/test_attachments.py` (a thread attachment is off the generic `/files` routes, a guardian never downloads an internal note's file, an oversight download is audited); `e2e/tests/live/api/communication-threads-broadcast.spec.ts`; that a new thread endpoint resolves through `visible_threads` is review only

## Context

Every other tenant list in this codebase is narrowed by `scope_queryset`, the role's record
scope (`all`, `campus`, `assigned`, `own`). A conversation does not fit it. A scope-`all` school
admin would see every private exchange between a parent and a teacher, while an `assigned`-scope
class teacher, the production default, would see nothing: a thread has no section to be
assigned through, yet the class teacher is exactly who a guardian's thread is routed to
(`threads/routing.py`, parent-portal.md §7). The school still needs a way to read threads it is
not part of, for safeguarding. Decided in plan
`docs/superpowers/plans/2026-10-31-communication-threads-and-broadcast.md` (PR C).

## Decision

1. **Membership is the authorization.** `/message-threads` and its `/messages`, `:mark-read`,
   `:close` and `:reopen` resolve a thread through one function, `threads.viewset.visible_threads`:
   threads whose `participant_user_ids` contain the caller (`MessageThread.participant_filter`,
   served by the GIN index). Record scope is not consulted. A miss is 404, never 403.
2. **A guardian or student must still own the child.** For a restricted principal,
   `visible_threads` also requires the thread's student to be in
   `Student.filter_owned_by_user` (portal access on). Revoking a guardian's access cuts them off
   from the conversations about that child, not just from the child's record.
3. **One write path.** Every message, the opening one included, goes through
   `services/post_message.post_message`, which re-checks the same two rules under a row lock
   (404 to a non-participant or a revoked guardian), refuses a closed thread (409) and an
   internal note from a guardian or student (422), and notifies everyone who can read the new
   message: the opening message reaches the routed staff, a reply reaches the other
   participants, and guardians and students are left out of an internal note and out of a
   thread about a child they no longer own.
4. **Oversight is separate, read-only and audited.** `communication.thread.oversee`
   (`school_owner`, `principal`) reads every alive thread in the tenant at
   `/message-thread-oversight`, internal notes included. Each retrieve writes an
   `oversight_view` audit row and each messages page an `oversight_view_messages` row that
   records its cursor. The list is not audited: it shows subjects and ids, not content.
   Oversight never stamps `read_by` and never notifies anyone.
5. **The oversight audit is fail-open**, as `core.audit.services.record_audit` is everywhere:
   it never raises, so a failed audit insert does not block the read.

## Alternatives considered

- **`scope_queryset` like every other list** — why not: it shows a scope-`all` admin every
  conversation and an `assigned` class teacher none, the opposite of what a thread needs.
- **An `assigned` scope resolved through the thread's student's section** — why not: a teacher
  who stops being class teacher would lose the threads they are answering, and a newly assigned
  one would see conversations they were never part of.
- **Give overseers access through the normal inbox** — why not: an overseer would appear to
  take part, would stamp read receipts and would be notified; a separate endpoint keeps the
  read visible in the audit log and invisible to the participants.
- **Fail-closed oversight audit** (refuse the read if the audit row cannot be written) — why
  not: it would be the one audit call in the codebase that raises, against `record_audit`'s
  documented contract; a database failure that loses the audit row would usually fail the read
  too.

## Consequences

- An admin with scope `all` does not see a thread unless they take part in it or hold
  `thread.oversee`; the inbox answers 404, which the live spec checks for the principal.
- Oversight covers the whole tenant: a campus-scoped principal oversees every campus's threads.
  Campus-narrowed oversight is deferred (`docs/deferred-work.md`).
- `participant_user_ids` is a JSON array, so a thread's membership is fixed at creation; adding
  or removing a participant, and the §19 `message_participants` join table, are deferred.
- A thread attachment is as private as its thread. `communication.thread-attachment` is a
  module-gated upload purpose (`core/files/purposes.py`), so the generic `GET /files` and
  `:download`, open to every `platform.file.view` holder, never reach it. Participants download
  through `/message-threads/{id}/attachments/{file_id}:download` under the same membership rule
  (a guardian or student never gets a file only an internal note carries); an overseer through
  the oversight twin, audited as `oversight_download_attachment`.
- Replies and `:mark-read` are not audited (a message is itself an immutable, attributed record;
  a read receipt is the caller's own state). Thread create, close and reopen are.
