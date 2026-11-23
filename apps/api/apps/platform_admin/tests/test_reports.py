"""Platform reports: aggregates read from `tenants` and the usage snapshots, never a school's
own tables (platform-admin.md §13, multi-tenancy §8)."""

from __future__ import annotations

import csv
import io
from datetime import timedelta
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status

from apps.platform_admin.reports.registry import REPORTS
from apps.platform_admin.tests.base import (
    PlatformAPITestCase,
    bearer,
    make_plan,
    make_tenant,
    platform_user,
)
from apps.platform_admin.tests.test_usage import snapshot_of
from apps.school_organization.tests.factories import UserFactory, grant
from core.tenancy.models import Tenant, TenantStatus
from core.tenancy.rls import tenant_owned_tables

S = TenantStatus
GIB = 1024**3
REPORTS_URL = "/api/v1/platform/reports"


def report_url(key: str, fmt: str | None = None) -> str:
    return f"{REPORTS_URL}/{key}" + (f"?format={fmt}" if fmt else "")


class ReportTests(PlatformAPITestCase):
    def sections(self, key: str) -> dict[str, list[dict]]:
        response = self.client.get(report_url(key))
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        data = response.json()["data"]
        self.assertEqual(data["key"], key)
        return data["sections"]

    def test_revenue_never_sums_across_currencies(self) -> None:
        pkr, usd = make_plan(currency="PKR"), make_plan(currency="USD")
        for amount in ("5000.00", "7000.00"):
            snapshot_of(
                make_tenant(status=S.ACTIVE),
                plan_code=pkr.code,
                currency="PKR",
                mrr_amount=Decimal(amount),
            )
        snapshot_of(
            make_tenant(status=S.PAST_DUE), plan_code=usd.code, currency="USD", mrr_amount=40
        )
        # A deprovisioned school's subscription is not recurring revenue.
        snapshot_of(
            make_tenant(status=S.DEPROVISIONED),
            plan_code=usd.code,
            currency="USD",
            mrr_amount=999,
        )

        rows = self.sections("revenue")["mrr"]

        by_key = {(row["plan_code"], row["currency"]): row for row in rows}
        self.assertEqual(set(by_key), {(pkr.code, "PKR"), (usd.code, "USD")})
        self.assertEqual(Decimal(by_key[(pkr.code, "PKR")]["mrr"]), Decimal("12000.00"))
        self.assertEqual(Decimal(by_key[(pkr.code, "PKR")]["arr"]), Decimal("144000.00"))
        self.assertEqual(by_key[(pkr.code, "PKR")]["paying_tenants"], 2)
        self.assertEqual(Decimal(by_key[(usd.code, "USD")]["mrr"]), Decimal("40.00"))
        self.assertEqual(by_key[(usd.code, "USD")]["past_due"], 1)
        # No row carries an amount without its currency: nothing is summed across them.
        for row in rows:
            self.assertTrue(row["currency"], row)

    def test_revenue_reads_each_school_s_latest_snapshot_only(self) -> None:
        plan = make_plan(currency="PKR")
        tenant = make_tenant(status=S.ACTIVE)
        snapshot_of(
            tenant, ago=timedelta(days=2), plan_code=plan.code, currency="PKR", mrr_amount=100
        )
        snapshot_of(tenant, plan_code=plan.code, currency="PKR", mrr_amount=300)

        (row,) = self.sections("revenue")["mrr"]

        self.assertEqual(Decimal(row["mrr"]), Decimal("300.00"))

    def test_tenant_overview_counts_states_signups_and_churn(self) -> None:
        make_tenant(status=S.ACTIVE)
        make_tenant(status=S.ACTIVE)
        make_tenant(status=S.TRIAL)
        make_tenant(status=S.DEPROVISIONED, deprovision_after=timezone.now() + timedelta(days=90))
        make_tenant(status=S.ACTIVE, deleted_at=timezone.now())

        sections = self.sections("tenant-overview")

        counts = {row["status"]: row["tenants"] for row in sections["by_status"]}
        self.assertEqual(counts[S.ACTIVE], 2)
        self.assertEqual(counts[S.TRIAL], 1)
        self.assertEqual(counts[S.DEPROVISIONED], 1)
        self.assertEqual(counts[S.SUSPENDED], 0)
        this_month = timezone.now().strftime("%Y-%m")
        signups = {row["month"]: row["tenants"] for row in sections["signups"]}
        self.assertEqual(signups[this_month], 4)
        churn = {row["month"]: row["tenants"] for row in sections["churn"]}
        self.assertEqual(churn[this_month], 1)

    def test_usage_distribution_pressure_and_adoption(self) -> None:
        plan = make_plan(limits={"students": 100, "staff": None, "storage_gb": 10})
        crowded = make_tenant(status=S.ACTIVE)
        snapshot_of(
            crowded,
            plan_code=plan.code,
            students=95,
            staff=4,
            storage_bytes=2 * GIB,
            modules_enabled=["module.fees", "module.students"],
        )
        roomy = make_tenant(status=S.ACTIVE)
        snapshot_of(
            roomy, plan_code=plan.code, students=10, staff=2, modules_enabled=["module.students"]
        )

        sections = self.sections("usage")

        dist = {row["metric"]: row for row in sections["distribution"]}
        self.assertEqual(dist["students"]["tenants"], 2)
        self.assertEqual(Decimal(str(dist["students"]["max"])), 95)
        self.assertEqual(Decimal(str(dist["students"]["min"])), 10)
        pressure = sections["quota_pressure"]
        self.assertEqual(
            [(row["tenant_id"], row["metric"]) for row in pressure], [(str(crowded.pk), "students")]
        )
        adoption = {
            (row["plan_code"], row["module"]): row["tenants"] for row in sections["adoption"]
        }
        self.assertEqual(adoption[(plan.code, "module.students")], 2)
        self.assertEqual(adoption[(plan.code, "module.fees")], 1)

    def test_reports_read_no_tenant_owned_table(self) -> None:
        plan = make_plan()
        tenant = make_tenant(status=S.ACTIVE)
        snapshot_of(tenant, plan_code=plan.code, currency="PKR", mrr_amount=10, students=3)
        # The builders alone: no school table, and no school's users (the request below also
        # reads the operator's own user and roles to authenticate, so it is checked apart).
        for key, report in REPORTS.items():
            with self.subTest(builder=key), CaptureQueriesContext(connection) as queries:
                report.build()
            self.assertTrue(queries.captured_queries, key)
            for query in queries.captured_queries:
                for table in (*tenant_owned_tables(), "users", "user_roles"):
                    self.assertNotIn(f'"{table}"', query["sql"], (key, table))

        forbidden = set(tenant_owned_tables())
        for key in ("tenant-overview", "revenue", "usage"):
            for fmt in ("json", "csv", "xlsx"):
                with self.subTest(key=key, fmt=fmt), CaptureQueriesContext(connection) as queries:
                    response = self.client.get(report_url(key, fmt))
                    self.assertEqual(response.status_code, status.HTTP_200_OK)
                for query in queries.captured_queries:
                    for table in forbidden:
                        self.assertNotIn(f'"{table}"', query["sql"], (key, table))
                    # Nothing binds a school: the reports never enter one's RLS boundary.
                    self.assertNotIn("set_config", query["sql"], key)

    def test_csv_and_xlsx_download_as_attachments(self) -> None:
        snapshot_of(make_tenant(status=S.ACTIVE), plan_code="p", currency="PKR", mrr_amount=5)

        response = self.client.get(report_url("revenue", "csv"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response["Content-Type"], "text/csv")
        self.assertIn("attachment", response["Content-Disposition"])
        rows = list(csv.DictReader(io.StringIO(response.content.decode())))
        self.assertEqual(rows[0]["section"], "mrr")
        self.assertEqual(rows[0]["currency"], "PKR")

        response = self.client.get(report_url("usage", "xlsx"))
        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertTrue(response["Content-Type"].startswith("application/vnd.openxmlformats"))

    def test_unknown_key_or_format(self) -> None:
        self.assertEqual(
            self.client.get(report_url("payroll")).status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertEqual(
            self.client.get(report_url("revenue", "pdf")).status_code, status.HTTP_400_BAD_REQUEST
        )

    def test_gates(self) -> None:
        # `platform_support` holds the key too (§4).
        self.sign_in_as(platform_user("platform_support"))
        self.assertEqual(self.client.get(report_url("usage")).status_code, status.HTTP_200_OK)

        self.sign_in_as(platform_user(None))
        self.assertEqual(
            self.client.get(report_url("usage")).status_code, status.HTTP_403_FORBIDDEN
        )

        principal = UserFactory(tenant=make_tenant(status=S.ACTIVE))
        grant(principal, "platform.job.view")
        self.client.credentials(HTTP_AUTHORIZATION=bearer(principal))
        self.assertEqual(
            self.client.get(report_url("usage")).status_code, status.HTTP_404_NOT_FOUND
        )
        self.assertTrue(Tenant.objects.exists())
