# Runbook — Disaster Recovery Drill

**Purpose.** Prove, on a schedule, that the backups restore and that the RTO and
RPO targets are real. **A backup that has not been restore-tested does not
exist.**

**Cadence.** Quarterly, plus after any change to the database topology, the
backup configuration, or the restore tooling.

**Targets under test.**

| Scenario | Target |
| --- | --- |
| RPO — maximum data loss | ≤ 5 minutes |
| RTO — database restore | ≤ 4 hours |
| RTO — full region loss | ≤ 24 hours |

**Rules.** The drill runs against **production backups** restored into an
**isolated account or VPC**. It never touches production itself. The restored
data is production PII and is deleted at the end — a drill that leaves a copy
lying around has created the breach it was meant to prevent.

**Spec.** [`hosting-deployment.md`](../../docs/02-architecture/hosting-deployment.md) §9.

## Preconditions

- [ ] Scheduled in advance; on-call knows it is a drill so alerts are not
      mistaken for a real incident.
- [ ] An isolated target: separate account, or at minimum a separate VPC with no
      route to production.
- [ ] A stopwatch. **Start it at step 1 and do not stop it until step 9.** The
      number is the deliverable; everything else is procedure.
- [ ] A scribe recording each step's timestamp, including the mistakes and the
      time spent reading documentation. Especially those.
- [ ] The drill log from last quarter, so regressions are visible.
- [ ] Nobody who runs this drill quarterly should be the only person who can.
      Rotate the operator; a runbook only one person can execute is not a
      runbook.

## Steps

1. **Start the clock.** Record the wall-clock time.
2. **Pick a target timestamp** roughly 24 hours ago and write down what the data
   should look like at that moment (approximate tenant count, a known invoice
   total, a known student record).
3. **Verify the backup exists before relying on it:**
   ```
   aws rds describe-db-instances \
     --db-instance-identifier schoolhub-production-postgres \
     --query 'DBInstances[0].{Earliest:EarliestRestorableTime,Latest:LatestRestorableTime}'
   ```
   The window must cover the target timestamp and the gap between
   `LatestRestorableTime` and now must be **≤ 5 minutes** — that gap *is* the
   measured RPO.
4. **Restore PITR** into the isolated environment:
   ```
   aws rds restore-db-instance-to-point-in-time \
     --source-db-instance-identifier schoolhub-production-postgres \
     --target-db-instance-identifier schoolhub-drill-$(date -u +%Y%m%d) \
     --restore-time <target-timestamp> \
     --db-subnet-group-name <isolated-subnet-group> \
     --no-publicly-accessible
   ```
   Record when it reports `available`. This is usually the largest single
   contributor to the RTO.
5. **Re-apply roles and grants:** run `postgres/init/02-app-role.sql` against
   the restored instance with drill-only passwords.
6. **Run the tenant-boundary assertions** — the same ones `scripts/restore.sh`
   runs. This is not a formality: a restore that silently loses RLS is the
   failure mode the whole drill exists to catch.
7. **Restore object storage** for one tenant prefix into a drill bucket and
   confirm a sample of files opens and matches its checksum.
8. **Start the application** against the restored data in the isolated
   environment. Log in as two tenants. Confirm each sees its own data and only
   its own data.
9. **Stop the clock.** Record the elapsed time. That is the measured RTO.
10. **Tear down completely:** delete the drill instance, the drill bucket, the
    drill secrets and any local dump files. Verify with
    `aws rds describe-db-instances` and `aws s3 ls` that nothing remains.
11. **Write the drill log:** date, operator, measured RPO, measured RTO, every
    step that took longer than expected, every command in the runbook that was
    wrong, and every manual step that should be automated.

## Verification

The drill passes only if all of these hold:

1. Measured **RPO ≤ 5 minutes**.
2. Measured **RTO ≤ 4 hours**, end to end, including the steps where you were
   reading this document.
3. Row counts and the known invoice total match the expectations from step 2.
4. The tenant-boundary assertions passed: no `BYPASSRLS`, no app-owned tables,
   RLS enabled on every table carrying `tenant_id`.
5. With no `app.tenant_id` set, a query as the app role returns **0 rows**.
6. Two tenants' data are visibly separate in the running application.
7. Restored files open and match their checksums.
8. Every drill resource is gone at the end.
9. The runbook needed no undocumented step. If it did, the drill has found a
   defect — in the runbook. Fix it this week, not next quarter.

## Rollback

A drill cannot damage production if the rules were followed. If something did
reach production:

1. **Stop.** Treat it as a live incident under [`incident.md`](incident.md).
2. The most likely cause is a command run against the production identifier by
   mistake. Check CloudTrail for what was actually called and by whom.
3. If a drill instance was created in the production account, delete it — but
   only after confirming it is the drill instance, by identifier, twice.
4. If drill credentials were created in production, rotate them via
   `scripts/rotate-secrets.sh`.
5. If production PII left its account boundary, that is a data-handling incident
   with disclosure obligations, not an engineering inconvenience. Escalate.
6. Postmortem: the account isolation that was supposed to make this impossible
   did not. Fix the isolation, not the operator.
