"""The per-tenant sweep every scheduled maintenance job is built on.

The assertion that matters most here is `test_a_sweep_without_a_bound_tenant_sees_nothing`:
it pins the reason `for_each_tenant` exists at all. An unbound cross-tenant delete does
not raise under RLS — it silently matches no rows — so a maintenance job written the
obvious way would report success forever while pruning nothing.
"""

from __future__ import annotations

import uuid

from django.test import TestCase

from apps.school_organization.tests.factories import TenantFactory
from core.jobs.models import BackgroundJob
from core.jobs.tests.factories import BackgroundJobFactory
from core.tenancy.context import set_database_tenant, tenant_context
from core.tenancy.maintenance import active_tenant_ids, for_each_tenant


class ActiveTenantIdsTests(TestCase):
    def test_lists_every_live_tenant(self) -> None:
        first = TenantFactory()
        second = TenantFactory()

        ids = set(active_tenant_ids())

        self.assertIn(first.pk, ids)
        self.assertIn(second.pk, ids)

    def test_skips_a_soft_deleted_tenant(self) -> None:
        from django.utils import timezone

        gone = TenantFactory()
        gone.deleted_at = timezone.now()
        gone.save(update_fields=["deleted_at"])

        self.assertNotIn(gone.pk, set(active_tenant_ids()))


class ForEachTenantTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.first = TenantFactory()
        self.second = TenantFactory()

    def test_runs_the_step_once_per_tenant_with_that_tenant_bound(self) -> None:
        seen: list[uuid.UUID] = []

        def step(tenant_id: uuid.UUID) -> int:
            from core.tenancy.context import get_current_tenant_id

            # The step must run with its tenant already bound — that is the whole
            # contract, and what makes an ordinary `Model.objects` query correct.
            assert get_current_tenant_id() == tenant_id
            seen.append(tenant_id)
            return 1

        summary = for_each_tenant(step, job="test-sweep")

        self.assertIn(self.first.pk, seen)
        self.assertIn(self.second.pk, seen)
        self.assertEqual(summary["tenants"], len(seen))
        self.assertEqual(summary["affected"], len(seen))
        self.assertEqual(summary["failed"], 0)

    def test_one_tenant_raising_does_not_abort_the_sweep(self) -> None:
        visited: list[uuid.UUID] = []

        def step(tenant_id: uuid.UUID) -> int:
            visited.append(tenant_id)
            if tenant_id == self.first.pk:
                raise RuntimeError("bad data for this tenant")
            return 2

        with self.assertLogs("core.tenancy.maintenance", level="ERROR"):
            summary = for_each_tenant(step, job="test-sweep")

        # Every tenant was still visited; only the failing one is counted as failed.
        self.assertIn(self.first.pk, visited)
        self.assertIn(self.second.pk, visited)
        self.assertEqual(summary["failed"], 1)
        self.assertEqual(summary["affected"], (summary["tenants"] - 1) * 2)

    def test_the_default_manager_sees_nothing_without_a_bound_tenant(self) -> None:
        """Layer 1 of why for_each_tenant binds per tenant rather than sweeping once.

        Two layers stop an unbound sweep, and neither of them *errors* — they
        return zero rows, which is the failure mode a maintenance job must not
        have: it would look like a successful sweep forever while pruning
        nothing. This asserts the first, `TenantScopedManager` returning
        `.none()` with no tenant bound; the test below asserts the second.
        """
        set_database_tenant(None)

        self.assertEqual(BackgroundJob.objects.count(), 0)

        with tenant_context(self.first.pk):
            BackgroundJobFactory(tenant=self.first)
            self.assertEqual(BackgroundJob.objects.count(), 1)

        set_database_tenant(None)
        self.assertEqual(BackgroundJob.objects.count(), 0)

    def test_rls_itself_hides_the_rows_from_an_unbound_sweep(self) -> None:
        """Layer 2: the database, not the Python manager.

        This assertion could not be made until CI stopped connecting as a
        superuser. `.github/workflows/api.yml` used to use `schoolhub`, the
        postgres image's `POSTGRES_USER`, which both owns the tables and
        bypasses RLS even with FORCE set — so the test would have passed on the
        Python manager alone and proved nothing about the policy. CI now creates
        and connects as the non-owning, NOBYPASSRLS `schoolhub_app` role, which
        is what the compose stack and Terraform have always used, so the two
        layers can finally be told apart.

        Kept separate from `tests/test_rls_enforcement.py`, which asserts the
        same mechanism platform-wide, because the two answer different
        questions: that one pins that RLS works at all, this one pins *why
        `for_each_tenant` is shaped the way it is*. Delete this and the helper's
        design rationale has no executable counterpart — a later refactor to a
        single cross-tenant sweep would pass the platform test and silently prune
        nothing.

        `all_tenants` is the point: it deliberately skips the Python scoping, so
        the only thing left standing between the query and the rows is the RLS
        policy. `current_setting('app.tenant_id', true)` resolves to NULL when
        nothing is bound, `tenant_id = NULL` is NULL rather than true, and no row
        matches — quietly, which is exactly why `for_each_tenant` exists.
        """
        with tenant_context(self.first.pk):
            BackgroundJobFactory(tenant=self.first)
            self.assertEqual(BackgroundJob.all_tenants.count(), 1)

        set_database_tenant(None)

        self.assertEqual(
            BackgroundJob.all_tenants.count(),
            0,
            "the unscoped manager still saw rows — RLS is not being enforced for "
            "this connection, so every cross-tenant test in the suite is only "
            "testing the Python manager",
        )
