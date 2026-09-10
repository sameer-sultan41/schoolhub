"""`GET/PUT /api/v1/holiday-calendar` endpoint tests (module doc §16)."""

from __future__ import annotations

from rest_framework.test import APITestCase

from apps.school_organization import calendar
from apps.school_organization.tests.factories import (
    MONDAY,
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
    holiday,
)
from core.tenancy.context import tenant_context


class HolidayCalendarEndpointTests(APITestCase):
    """`GET/PUT /api/v1/holiday-calendar` — school-organization.md §16."""

    url = "/api/v1/holiday-calendar"

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        grant(self.user, "school.settings.view", "school.settings.update")
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)

    def test_get_returns_the_defaults_for_an_unconfigured_tenant(self) -> None:
        response = self.client.get(self.url)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.data["data"]["working_days"], [0, 1, 2, 3, 4])
        self.assertEqual(response.data["data"]["holidays"], [])

    def test_put_replaces_the_whole_list(self) -> None:
        """§16 says PUT, not PATCH: merging entry by entry would leave no way to
        *remove* a holiday, which is what a cancelled closure needs."""
        first = self.client.put(
            self.url,
            {
                "working_days": [0, 1, 2, 3, 4],
                "holidays": [holiday("2026-12-25", "Christmas")],
            },
            format="json",
        )
        self.assertEqual(first.status_code, 200)

        second = self.client.put(
            self.url,
            {"holidays": [holiday("2027-03-23", "Republic Day")]},
            format="json",
        )
        self.assertEqual(second.status_code, 200)

        response = self.client.get(self.url)
        names = [entry["name"] for entry in response.data["data"]["holidays"]]
        self.assertEqual(names, ["Republic Day"])

    def test_the_calendar_the_endpoint_wrote_is_the_one_marking_reads(self) -> None:
        """The point of the whole task: what an admin saves is what
        `is_working_day` answers with."""
        self.client.put(
            self.url,
            {"holidays": [holiday("2026-09-07", "Founders Day")]},
            format="json",
        )
        with tenant_context(self.tenant.id):
            self.assertFalse(calendar.is_working_day(MONDAY))

    def test_a_range_that_ends_before_it_starts_is_refused(self) -> None:
        response = self.client.put(
            self.url,
            {"holidays": [holiday("2026-12-26", "Backwards", end="2026-12-24")]},
            format="json",
        )
        self.assertEqual(response.status_code, 400)

    def test_an_empty_working_week_is_refused(self) -> None:
        response = self.client.put(self.url, {"working_days": []}, format="json")

        self.assertEqual(response.status_code, 400)

    def test_another_tenants_campus_cannot_be_named_in_a_holiday(self) -> None:
        """These live in JSONB, so there is no FK to do the ownership check —
        the serializer does it, or a smuggled id is stored unchallenged."""
        other_tenant = TenantFactory()
        with tenant_context(other_tenant.id):
            foreign_campus = CampusFactory(tenant=other_tenant)

        response = self.client.put(
            self.url,
            {"holidays": [holiday("2026-09-07", "Theirs", campus_id=foreign_campus.pk)]},
            format="json",
        )

        self.assertEqual(response.status_code, 400)

    def test_view_permission_alone_cannot_write(self) -> None:
        reader = UserFactory(tenant=self.tenant)
        authenticate(self.client, reader)
        grant(reader, "school.settings.view")

        response = self.client.put(self.url, {"working_days": [0, 1]}, format="json")

        self.assertEqual(response.status_code, 403)
