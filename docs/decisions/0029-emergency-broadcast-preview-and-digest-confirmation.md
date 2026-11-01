# 0029. An emergency broadcast is sent only by repeating its preview's count and audience digest

- **Status:** Accepted
- **Date:** 2026-11-01
- **Enforced by:** `apps/api/apps/communication/broadcasts/tests/test_dispatch.py` (a stale count, and the same count with a different audience, are each a 409 that creates no job; a repeated `Idempotency-Key` replays one job, and the same key with a corrected message is a 422), `test_scope.py` (campus-scoped senders), `test_task.py` (frozen recipients, the `emergency` queue, preferences bypassed, a failed fan-out leaves nothing, a redelivered task sends nothing), `apps/api/core/jobs/tests/test_claim.py` (the job is claimed by one conditional UPDATE), `apps/api/core/idempotency/tests/test_replay.py` (the same body replays, a different body is refused, a legacy row replays); `e2e/tests/live/api/communication-threads-broadcast.spec.ts` (preview, a tampered digest refused, send, replay, the job)

## Context

`communication.md` §7 describes the emergency broadcast as a send with "no approval gate by
design (speed)", mitigated by a narrow permission and audit, and with "a confirmation step
[that] restates audience size and channels". The send ignores preferences and quiet hours and
reaches every channel, so a broadcast to the wrong audience cannot be recalled. A confirmation
screen that only the client shows proves nothing to the server: a stale tab, or an audience that
changed between preview and send, would still go out. Decided in plan
`docs/superpowers/plans/2026-10-31-communication-threads-and-broadcast.md` (PR C).

## Decision

1. **Preview, then send.** `POST /broadcasts:preview` resolves the audience and returns
   `recipient_count`, `audience_digest` (sha256 hex of the sorted recipient ids joined by `,`),
   the `channels` that have an adapter and the `unavailable_channels` that do not. It writes
   nothing.
2. **The send repeats the preview back.** `POST /broadcasts:emergency` takes the same request
   plus `confirm_recipient_count` and `audience_digest`, resolves the audience again with the
   same functions, and compares both. A mismatch is `409 audience_changed` with the current
   count and digest in `error.meta`, raised before anything is written, so no job exists.
3. **The confirmed audience is frozen.** The job's payload holds the recipient ids; the task
   (`tasks.send_emergency_broadcast_task`) sends to exactly those, not to whatever the audience
   resolves to when a worker picks it up. The task runs on the `emergency` queue, and so do its
   deliveries (`core/notifications/queues.py`, notifications.md §5).
4. **One fan-out per click.** `Idempotency-Key` replays the first `202` and `job_id`
   (`replay_or_execute`), and the jobs table's partial unique index on `(tenant, idempotency_key)` (live rows with a key;
   `core/jobs/models.py`) refuses a second job from two racing requests. A 409 is raised, not returned, so it is never stored and a retry
   with the same key re-checks the audience. The key is bound to the request body: the stored
   record carries a sha256 fingerprint of the canonical body, and the same key with a different
   body (a corrected message to an unchanged audience) is `422 idempotency_key_reused`, not a
   silent replay of the first broadcast's `202`. A client mints a key per (preview result,
   message, audience), not per preview alone.
5. **The sender's record scope binds the audience** (`broadcasts/services/scope.py`). An
   `all`-scoped sender is unrestricted. A campus-scoped sender must give one of their campuses
   as `campus_id` (none is 422, another is 404), and a `custom` audience may name only users
   that campus's audience contains (else 404). A sender with only `own` or `assigned` scope
   reaches nothing: 404, not the "choose a campus" 422, since there is no campus to choose.
   The scope is read from the roles that grant `communication.broadcast.send` only
   (`core.rbac.permissions.scopes_for`, named `user_scopes_for_key` before ADR-0031), since a
   scope belongs to its `user_role`.
   The recipient side deliberately reads differently: a campus-narrowed `staff` audience
   (`audience._resolve_staff`) includes anyone holding an `all`-scoped role, whatever that role
   grants, because a tenant-wide staff member works at every campus and an emergency there
   must reach them. The sender's limit is about what they may do; the audience is about who is
   on the campus.
6. **Audited.** Each send writes a `broadcast` audit row with the message, count, channels,
   unavailable channels and audience.

## Alternatives considered

- **Count only** — why not: one recipient leaving while another joins keeps the count and
  changes who is reached. The digest catches that.
- **An approval gate (a second person confirms)** — why not: §7 rules it out for speed; the
  confirmation is the sender's own, and the permission and audit are the mitigation.
- **A server-held preview token** (store the resolved audience, send by token) — why not: a new
  table and an expiry policy for what a digest already proves; the digest is stateless.
- **Resolve the audience in the task** — why not: the worker could reach people the sender never
  saw. Freezing the ids on the job sends exactly what was confirmed.
- **A typed confirmation phrase** (§11's recommendation) — why not now: it proves attention, not
  the audience; it can sit on top of this later, in the client.

## Consequences

- `replay_or_execute` now takes the request body for every caller (fees, attendance,
  examinations, students, staff, academics too): a key reused with a different body is refused
  platform-wide. Records stored before the fingerprint column existed (empty) still replay for
  their remaining window.
- **The remaining limit: the digest proves the recipient set, not that a human read it.** A
  client can call preview and send back to back without showing anything. The dashboard must
  show the count and channels and ask for confirmation; the server cannot tell whether it did.
  MFA step-up for the send (§4's "MFA-recommended") is deferred (`docs/deferred-work.md`).
- A broadcast to a large school sends the whole recipient list in one `notify()` call and one
  `deliver_notifications` task; notifications.md §5's ~500-recipient batches are deferred.
- An `Idempotency-Key` longer than 64 characters is a 500 (the job column's length), shared with
  `fee-invoices:generate`; reusing a key after its 24-hour replay window is a generic 409 from
  the unique index. Both are in `docs/deferred-work.md`.
- `job.error` carries the exception text to whoever polls the job, as every other job does.
