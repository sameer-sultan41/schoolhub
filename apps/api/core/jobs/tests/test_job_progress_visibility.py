"""Regression coverage for the bug fixed in core.tenancy.tasks.TenantAwareTask.

Before the fix, TenantAwareTask.__call__ opened one long-lived transaction
spanning a Celery task's entire body and bound the tenant GUC once, before the
task started. mark_running/update_progress/mark_succeeded/mark_failed's own
`@transaction.atomic` then only ever nested as a savepoint inside that already-
GUC'd transaction — none of them set the tenant GUC themselves. Once the task
stopped opening that one big transaction (see that module's docstring for why:
progress writes need to be visible to a polling connection before the task
finishes, and a killed worker must not discard a failure it was recording),
calling any of these with no caller-established GUC would have silently
updated zero rows — Postgres's RLS `USING` clause makes an unmatched row look
like it simply is not there to an UPDATE, not an error.

TestCase (unlike TransactionTestCase) wraps the whole test body in one real
transaction, and `SET LOCAL`'s scope is that whole transaction regardless of
how many nested savepoints run inside it — so under TestCase, a GUC set once
in setUp would still look set for the rest of the test even if the function
under test never set it itself, hiding exactly this bug. TransactionTestCase
runs each test in real, independent, unwrapped transactions, so each
`tenant_atomic` call's GUC only lasts for its own transaction — the same
shape a real Celery task runs in.
"""

from __future__ import annotations

from django.test import TransactionTestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.jobs.models import BackgroundJob, JobStatus
from core.jobs.services import (
    create_job,
    mark_failed,
    mark_running,
    mark_succeeded,
    update_progress,
)
from core.tenancy.context import tenant_atomic


class JobLifecycleStandaloneTests(TransactionTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_atomic(self.tenant.id):
            self.user = UserFactory(tenant=self.tenant)
            self.job = create_job(
                tenant_id=self.tenant.id,
                job_type="import.students",
                payload={},
                actor_id=self.user.pk,
            )

    def _reload(self) -> BackgroundJob:
        with tenant_atomic(self.tenant.id):
            return BackgroundJob.objects.get(pk=self.job.pk)

    def test_mark_running_and_update_progress_each_commit_on_their_own(self) -> None:
        mark_running(job=self.job)
        update_progress(job=self.job, progress=42)

        reloaded = self._reload()
        self.assertEqual(reloaded.status, JobStatus.RUNNING)
        self.assertEqual(reloaded.progress, 42)

    def test_mark_succeeded_commits_on_its_own(self) -> None:
        mark_running(job=self.job)
        mark_succeeded(job=self.job, result={"ok": True})

        reloaded = self._reload()
        self.assertEqual(reloaded.status, JobStatus.SUCCEEDED)
        self.assertEqual(reloaded.result, {"ok": True})

    def test_mark_failed_commits_on_its_own(self) -> None:
        mark_running(job=self.job)
        mark_failed(job=self.job, error="boom")

        reloaded = self._reload()
        self.assertEqual(reloaded.status, JobStatus.FAILED)
        self.assertEqual(reloaded.error, "boom")
