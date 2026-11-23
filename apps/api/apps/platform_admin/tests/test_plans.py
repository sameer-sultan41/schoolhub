"""`/api/v1/platform/plans`: the plan catalog (platform-admin.md §16, entities `plans`)."""

from __future__ import annotations

from rest_framework import status

from apps.platform_admin.models import Plan
from apps.platform_admin.tests.base import (
    PLANS_URL,
    PlatformAPITestCase,
    make_plan,
    make_tenant,
    platform_user,
)
from apps.school_organization.tests.factories import TenantFactory, UserFactory, grant
from core.audit.models import AuditLog
from core.tenancy.models import TenantStatus


def plan_body(**overrides) -> dict:
    return {
        "name": "Standard",
        "code": "standard",
        "description": "Most schools start here.",
        "price_amount": "5000.00",
        "currency": "PKR",
        "billing_period": "monthly",
        "trial_days": 21,
        "enabled_modules": ["module.timetable"],
        "limits": {"students": 500, "staff": None},
        **overrides,
    }


def plan_url(plan: Plan) -> str:
    return f"{PLANS_URL}/{plan.pk}"


def field_errors(response) -> set[str]:
    return {detail["field"] for detail in response.json()["error"]["details"]}


class PlanCatalogTests(PlatformAPITestCase):
    def test_create_lists_and_reads_a_plan(self) -> None:
        created = self.client.post(PLANS_URL, plan_body(), format="json")

        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.content)
        data = created.json()["data"]
        self.assertEqual(data["code"], "standard")
        self.assertEqual(data["enabled_modules"], ["module.timetable"])
        self.assertEqual(data["limits"], {"students": 500, "staff": None})
        self.assertEqual(data["trial_days"], 21)
        self.assertTrue(data["is_active"])

        listed = self.client.get(PLANS_URL)
        self.assertEqual(listed.status_code, status.HTTP_200_OK)
        self.assertEqual([row["code"] for row in listed.json()["data"]], ["standard"])

        detail = self.client.get(f"{PLANS_URL}/{data['id']}")
        self.assertEqual(detail.json()["data"]["name"], "Standard")
        row = AuditLog.objects.get(action="create", resource_id=data["id"])
        self.assertEqual((row.actor_id, row.tenant_id), (self.operator.pk, None))

    def test_create_needs_enabled_modules(self) -> None:
        body = plan_body()
        del body["enabled_modules"]

        response = self.client.post(PLANS_URL, body, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.content)
        self.assertEqual(field_errors(response), {"enabled_modules"})
        # An explicit empty list is a plan with no modules, and is accepted.
        empty = self.client.post(PLANS_URL, plan_body(enabled_modules=[]), format="json")
        self.assertEqual(empty.status_code, status.HTTP_201_CREATED, empty.content)

    def test_create_refuses_an_unknown_module_or_limit(self) -> None:
        for overrides, field in (
            ({"enabled_modules": ["module.no-such-module"]}, "enabled_modules"),
            ({"enabled_modules": ["ai.nl-queries"]}, "enabled_modules"),
            ({"limits": {"seats": 10}}, "limits"),
            ({"limits": {"students": -1}}, "limits"),
            ({"currency": "rupees"}, "currency"),
        ):
            with self.subTest(field=field, overrides=overrides):
                response = self.client.post(PLANS_URL, plan_body(**overrides), format="json")
                self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
                self.assertTrue(
                    any(name.startswith(field) for name in field_errors(response)),
                    response.content,
                )
        self.assertFalse(Plan.objects.exists())

    def test_a_taken_code_is_400(self) -> None:
        make_plan(code="standard")

        response = self.client.post(PLANS_URL, plan_body(), format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(field_errors(response), {"code"})

    def test_plan_code_immutable(self) -> None:
        plan = make_plan(code="standard")

        response = self.client.patch(plan_url(plan), {"code": "premium"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(field_errors(response), {"code"})
        plan.refresh_from_db()
        self.assertEqual(plan.code, "standard")

        renamed = self.client.patch(
            plan_url(plan), {"name": "Standard 2026", "code": "standard"}, format="json"
        )
        self.assertEqual(renamed.status_code, status.HTTP_200_OK, renamed.content)
        self.assertEqual(renamed.json()["data"]["name"], "Standard 2026")

    def test_acknowledge_over_usage_is_accepted(self) -> None:
        # The usage check behind it, and its 409 `limit_below_usage`, arrive with usage
        # snapshots in the next PR (ruling C3); the flag is part of the contract now.
        plan = make_plan(limits={"students": 500})

        response = self.client.patch(
            plan_url(plan),
            {"limits": {"students": 10}, "acknowledge_over_usage": True},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.content)
        plan.refresh_from_db()
        self.assertEqual(plan.limits, {"students": 10})

    def test_edits_are_audited_with_before_and_after(self) -> None:
        plan = make_plan(name="Basic")

        self.client.patch(plan_url(plan), {"name": "Basic Plus"}, format="json")

        row = AuditLog.objects.get(action="update", resource_id=plan.pk)
        self.assertEqual(row.before["name"], "Basic")
        self.assertEqual(row.after["name"], "Basic Plus")

    def test_delete_plan_in_use_is_409(self) -> None:
        plan = make_plan(code="standard")
        tenant = make_tenant(
            status=TenantStatus.ACTIVE, current_plan="standard", subscription_status="active"
        )

        response = self.client.delete(plan_url(plan))

        self.assert_error(response, status.HTTP_409_CONFLICT, "plan_in_use")
        plan.refresh_from_db()
        self.assertIsNone(plan.deleted_at)

        tenant.current_plan = ""
        tenant.save(update_fields=["current_plan"])
        retired = self.client.delete(plan_url(plan))

        self.assertEqual(retired.status_code, status.HTTP_204_NO_CONTENT, retired.content)
        plan.refresh_from_db()
        self.assertIsNotNone(plan.deleted_at)
        self.assertFalse(plan.is_active)
        self.assertEqual(self.client.get(PLANS_URL).json()["data"], [])
        self.assertEqual(self.client.get(plan_url(plan)).status_code, status.HTTP_404_NOT_FOUND)
        self.assertTrue(AuditLog.objects.filter(action="delete", resource_id=plan.pk).exists())

    def test_list_filters_by_is_active(self) -> None:
        make_plan(code="current")
        make_plan(code="legacy", is_active=False)

        response = self.client.get(f"{PLANS_URL}?is_active=true")

        self.assertEqual([row["code"] for row in response.json()["data"]], ["current"])

    def test_platform_support_reads_but_cannot_write(self) -> None:
        plan = make_plan()
        self.sign_in_as(platform_user("platform_support"))

        self.assertEqual(self.client.get(PLANS_URL).status_code, status.HTTP_200_OK)
        for response in (
            self.client.post(PLANS_URL, plan_body(), format="json"),
            self.client.patch(plan_url(plan), {"name": "x"}, format="json"),
            self.client.delete(plan_url(plan)),
        ):
            self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_tenant_principal_gets_404_on_plan_routes(self) -> None:
        plan = make_plan()
        school_user = UserFactory(tenant=TenantFactory())
        grant(school_user, "school.subscription.view")
        self.sign_in_as(school_user)

        self.assertEqual(self.client.get(PLANS_URL).status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.client.get(plan_url(plan)).status_code, status.HTTP_404_NOT_FOUND)
