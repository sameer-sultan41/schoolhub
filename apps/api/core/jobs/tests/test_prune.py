"""Retention for finished background jobs."""

from __future__ import annotations

import datetime

from django.test import TestCase
from django.utils import timezone

from apps.school_organization.tests.factories import TenantFactory
from core.jobs.models import BackgroundJob, JobStatus
from core.jobs.tasks import RETENTION, prune_background_jobs, prune_tenant
from core.jobs.tests.factories import BackgroundJobFactory
from core.tenancy.context import tenant_context


def _job(tenant, *, status: str, finished_age: datetime.timedelta | None) -> BackgroundJob:
    with tenant_context(tenant.id):
        return BackgroundJobFactory(
            tenant=tenant,
            status=status,
            finished_at=None if finished_age is None else timezone.now() - finished_age,
        )


class BackgroundJobPruneTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()

    def test_prunes_a_job_finished_past_the_retention_window(self) -> None:
        old = _job(
            self.tenant,
            status=JobStatus.SUCCEEDED,
            finished_age=RETENTION + datetime.timedelta(days=1),
        )

        with tenant_context(self.tenant.id):
            deleted = prune_tenant(self.tenant.pk)

        self.assertEqual(deleted, 1)
        with tenant_context(self.tenant.id):
            self.assertFalse(BackgroundJob.objects.filter(pk=old.pk).exists())

    def test_prunes_a_failed_job_too(self) -> None:
        _job(self.tenant, status=JobStatus.FAILED, finished_age=RETENTION * 2)

        with tenant_context(self.tenant.id):
            self.assertEqual(prune_tenant(self.tenant.pk), 1)

    def test_keeps_a_recently_finished_job(self) -> None:
        recent = _job(
            self.tenant, status=JobStatus.SUCCEEDED, finished_age=datetime.timedelta(days=1)
        )

        with tenant_context(self.tenant.id):
            self.assertEqual(prune_tenant(self.tenant.pk), 0)
            self.assertTrue(BackgroundJob.objects.filter(pk=recent.pk).exists())

    def test_never_prunes_a_job_that_has_not_finished(self) -> None:
        """A job stuck in `running` is an incident to investigate, not litter.

        Both rows below are older than the retention window; neither has a
        `finished_at`, and deleting them would destroy the evidence of a worker
        that died mid-task.
        """
        for status in (JobStatus.QUEUED, JobStatus.RUNNING):
            with self.subTest(status=status):
                stuck = _job(self.tenant, status=status, finished_age=None)
                with tenant_context(self.tenant.id):
                    prune_tenant(self.tenant.pk)
                    self.assertTrue(BackgroundJob.objects.filter(pk=stuck.pk).exists())

    def test_the_task_sweeps_every_tenant(self) -> None:
        other = TenantFactory()
        _job(self.tenant, status=JobStatus.SUCCEEDED, finished_age=RETENTION * 2)
        _job(other, status=JobStatus.SUCCEEDED, finished_age=RETENTION * 2)

        summary = prune_background_jobs()

        self.assertEqual(summary["affected"], 2)
        self.assertEqual(summary["failed"], 0)

    def test_one_tenants_jobs_are_never_visible_to_another(self) -> None:
        other = TenantFactory()
        mine = _job(self.tenant, status=JobStatus.SUCCEEDED, finished_age=RETENTION * 2)

        with tenant_context(other.id):
            self.assertEqual(prune_tenant(other.pk), 0)

        with tenant_context(self.tenant.id):
            self.assertTrue(BackgroundJob.objects.filter(pk=mine.pk).exists())
