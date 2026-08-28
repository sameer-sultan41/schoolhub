# Runbook — Incident Response

**Purpose.** Detect, contain, communicate and resolve a production incident, and
learn from it afterwards.

**Severity.**

| Sev | Meaning | Response | Examples |
| --- | --- | --- | --- |
| **SEV1** | Cross-tenant data exposure, or the platform is down for everyone | Page immediately, all hands | One school sees another's data; API down; database unreachable |
| **SEV2** | A module is broken for many tenants, or money is affected | Page on-call | Fee payments failing; results not publishing; auth broken for a role |
| **SEV3** | Degraded, with a workaround | Business hours | Slow reports; one notification channel failing |
| **SEV4** | Cosmetic or single-tenant, no data risk | Ticket | A layout bug; one tenant's logo not loading |

> **Any suspicion of cross-tenant data exposure is SEV1 until proven otherwise.**
> Not "if confirmed" — on suspicion. This platform's entire security model is one
> RLS boundary, and the failure mode is silent.

**Spec.** [`hosting-deployment.md`](../../docs/02-architecture/hosting-deployment.md) §10.

## Preconditions

- [ ] You can reach AWS, Sentry, the logs and the platform admin console.
- [ ] An incident channel exists. Open one even if it turns out to be nothing.
- [ ] Roles are named out loud: **incident lead** (decides), **scribe** (writes
      the timeline), **comms** (talks to tenants). One person may hold two, never
      all three.

## Steps

### 1. Triage (first 5 minutes)

1. State the symptom in one sentence: what is broken, for whom, since when.
2. Assign a severity from the table. When in doubt, go one level higher — it is
   cheap to downgrade and expensive to have under-called a SEV1.
3. Start the timeline. Every entry gets a UTC timestamp.
4. Answer explicitly: **is tenant data at risk?** If the answer is anything other
   than a confident no, it is SEV1 and step 5 happens now.

### 2. Contain (first 15 minutes)

5. **If cross-tenant exposure is suspected, stop the bleeding before diagnosing:**
   disable the affected module's feature flag platform-wide, or scale the
   affected service to 0. An unavailable module is recoverable; data that
   reached the wrong school is not.
6. If it started right after a deploy, roll back — [`rollback.md`](rollback.md).
   Correlation with a deploy is the single most useful signal you have.
7. If it is one tenant, consider suspending that tenant rather than degrading
   everyone.
8. Post the first tenant-facing update. Even "we are investigating" beats
   silence.

### 3. Diagnose

9. **Recent change first.** Deploys, migrations, feature flags, secret
   rotations, Terraform applies, provider incidents. Most incidents are a change.
10. Read the logs in this order: Sentry (what broke) → the service's CloudWatch
    log group (what it was doing) → RDS Performance Insights (what the database
    was doing).
11. For anything smelling of tenant isolation, check these three things, in this
    order, because they are the three ways the boundary fails:
    ```sql
    -- 1. Did the app role gain BYPASSRLS or superuser?
    SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname='schoolhub_app';
    -- 2. Does the app role own any table? An owner bypasses RLS unless FORCE.
    SELECT tablename FROM pg_tables WHERE schemaname='public' AND tableowner='schoolhub_app';
    -- 3. Is RLS still enabled on every tenant table?
    SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
    ```
12. Then check the pooler: `pool_mode` must be `transaction`, and application
    code must use `SET LOCAL` inside a transaction — never a session `SET`. A
    session `SET` under transaction pooling leaks tenant context between
    requests, and it only manifests under load, which is why it reaches
    production.
13. For a wrong-tenant *page* rather than wrong-tenant *data*, suspect the CDN:
    the cache key must include the `Host` header. A cache-key regression serves
    one school's homepage under another school's domain, from the edge, to the
    public.

### 4. Resolve

14. Apply the smallest fix that ends the incident. Fix forward only when it is
    genuinely faster and safer than rolling back — under pressure it rarely is.
15. Verify against [`deploy.md`](deploy.md) §Verification, including the
    two-tenant isolation check.
16. Watch for 30 minutes before declaring it resolved.

### 5. Communicate and close

17. Final tenant update: what happened, what was affected, what was done, and —
    if data was exposed — exactly which tenants and which records.
18. Declare resolved in the channel with a UTC timestamp.
19. Schedule the postmortem within 5 business days. Blameless, written, with
    dated owned action items.

## Verification

Before declaring resolved:

1. The original symptom is gone, confirmed by the person who reported it.
2. Error rate and p95 latency are at baseline for 30 consecutive minutes.
3. Two tenants each see their own data and only their own data.
4. All three isolation queries in step 11 return the safe answer.
5. Celery queues are draining; `celery-beat` `runningCount` is exactly 1.
6. No related alarm is still firing.
7. If data was corrupted, the affected rows are verified restored — see
   [`backup-restore.md`](backup-restore.md).
8. The timeline is complete enough that someone who was asleep can read it.

## Rollback

If the fix made it worse:

1. Revert to the state at the start of the incident, even if that state was
   degraded. A known-degraded platform beats an unknown one.
2. Escalate a level: add responders, and tell the incident lead you are changing
   approach.
3. Re-contain: feature flags off, affected services scaled down.
4. Explicitly reconsider severity — a failed fix usually means the blast radius
   is bigger than the first assessment assumed.
5. Do not attempt a second novel fix under time pressure. Contain, stabilize,
   then fix properly with review.
