"""The calendar `attendance` marks against.

Reads `tenant_settings.academic` rather than its own table: entities/tenancy.md
designates that JSONB for academic configuration, and a holiday list is
tenant-shaped config, not a relational entity. Defaults are deliberate — a tenant
that has configured nothing still gets Monday-Friday and an 08:00-14:00 day, so
attendance is usable before anyone opens the settings screen.

Dates here are chosen for their weekday and named in the assertion, because a
test that says `date(2026, 9, 5)` and means "a Saturday" is unreadable a year
from now.
"""

from __future__ import annotations

import datetime

from django.test import TestCase
from rest_framework.test import APITestCase

from apps.school_organization import calendar
from apps.school_organization.tests.factories import (
    CampusFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.tenancy.context import tenant_context
from core.tenancy.models import TenantSettings

SATURDAY = datetime.date(2026, 9, 5)
SUNDAY = datetime.date(2026, 9, 6)
MONDAY = datetime.date(2026, 9, 7)
FRIDAY = datetime.date(2026, 9, 4)


def holiday(start: str, name: str, end: str | None = None, campus_id=None) -> dict:
    """One entry in the stored (and wire) holiday shape.

    A builder rather than literals at each call site: an entry is four keys, two
    of which are almost always the same date, and the repetition buried what each
    test was actually varying.
    """
    entry = {"start_date": start, "end_date": end or start, "name": name}
    if campus_id is not None:
        entry["campus_id"] = str(campus_id)
    return entry


def configure(tenant, academic: dict) -> None:
    """Write the tenant's academic configuration the way the endpoint would."""
    with tenant_context(tenant.id):
        row, _ = TenantSettings.objects.get_or_create(tenant=tenant)
        row.academic = academic
        row.save(update_fields=["academic", "updated_at"])


class WorkingDayTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)

    def test_unconfigured_tenant_gets_monday_to_friday(self) -> None:
        with tenant_context(self.tenant.id):
            self.assertFalse(calendar.is_working_day(SATURDAY))
            self.assertTrue(calendar.is_working_day(MONDAY))

    def test_a_friday_saturday_weekend_is_configurable(self) -> None:
        """Pakistan and the Gulf do not weekend on Saturday/Sunday, and the
        platform assumes no country (school-organization.md §11)."""
        configure(self.tenant, {"working_days": [6, 0, 1, 2, 3]})  # Sun-Thu
        with tenant_context(self.tenant.id):
            self.assertFalse(calendar.is_working_day(FRIDAY))
            self.assertTrue(calendar.is_working_day(SUNDAY))

    def test_an_empty_working_week_falls_back_instead_of_closing_the_school(self) -> None:
        """`working_days: []` would otherwise make every date unmarkable
        forever, which no caller can have meant."""
        configure(self.tenant, {"working_days": []})
        with tenant_context(self.tenant.id):
            self.assertTrue(calendar.is_working_day(MONDAY))

    def test_a_holiday_range_is_closed_on_both_ends(self) -> None:
        configure(
            self.tenant,
            {"holidays": [holiday("2026-12-24", "Winter break", end="2026-12-26")]},
        )
        with tenant_context(self.tenant.id):
            self.assertFalse(calendar.is_working_day(datetime.date(2026, 12, 24)))
            self.assertFalse(calendar.is_working_day(datetime.date(2026, 12, 25)))
            self.assertFalse(calendar.is_working_day(datetime.date(2026, 12, 26)))
            self.assertTrue(calendar.is_working_day(datetime.date(2026, 12, 23)))
            self.assertEqual(calendar.holiday_name(datetime.date(2026, 12, 25)), "Winter break")

    def test_a_single_day_holiday_needs_no_end_date(self) -> None:
        configure(self.tenant, {"holidays": [holiday("2026-09-07", "Founders Day")]})
        with tenant_context(self.tenant.id):
            self.assertFalse(calendar.is_working_day(MONDAY))

    def test_a_campus_holiday_does_not_close_another_campus(self) -> None:
        with tenant_context(self.tenant.id):
            other = CampusFactory(tenant=self.tenant)
        configure(
            self.tenant,
            {"holidays": [holiday("2026-09-07", "Founders Day", campus_id=self.campus.pk)]},
        )
        with tenant_context(self.tenant.id):
            self.assertFalse(calendar.is_working_day(MONDAY, campus_id=self.campus.pk))
            self.assertTrue(calendar.is_working_day(MONDAY, campus_id=other.pk))

    def test_a_tenant_wide_holiday_closes_every_campus(self) -> None:
        """`campus_id: null` means every campus, the same reading `Period.campus`
        uses. A campus entry adds to the tenant-wide list, never replaces it."""
        configure(
            self.tenant,
            {"holidays": [holiday("2026-09-07", "National day")]},
        )
        with tenant_context(self.tenant.id):
            self.assertFalse(calendar.is_working_day(MONDAY, campus_id=self.campus.pk))

    def test_a_malformed_entry_is_skipped_not_raised_on(self) -> None:
        """One typed-in bad date must not take the whole register down."""
        configure(
            self.tenant,
            {
                "holidays": [
                    {"start_date": "not-a-date", "name": "Typo"},
                    holiday("2026-09-07", "Real"),
                ]
            },
        )
        with tenant_context(self.tenant.id):
            self.assertEqual(calendar.holiday_name(MONDAY), "Real")

    def test_another_tenants_calendar_is_not_visible(self) -> None:
        other_tenant = TenantFactory()
        configure(other_tenant, {"holidays": [holiday("2026-09-07", "Theirs")]})
        with tenant_context(self.tenant.id):
            self.assertIsNone(calendar.holiday_name(MONDAY))
            self.assertTrue(calendar.is_working_day(MONDAY))


class DayWindowTests(TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()

    def test_arrival_inside_the_grace_period_is_not_late(self) -> None:
        configure(
            self.tenant, {"day_window": {"start": "08:00", "end": "14:00", "grace_minutes": 10}}
        )
        with tenant_context(self.tenant.id):
            self.assertEqual(calendar.late_minutes(datetime.time(8, 9)), 0)
            self.assertEqual(calendar.late_minutes(datetime.time(8, 10)), 0)

    def test_lateness_is_measured_from_the_start_not_from_the_grace_end(self) -> None:
        """A student 25 minutes late is 25 minutes late, not 15. The grace period
        decides *whether* it counts, not how much is counted — otherwise the §13
        punctuality report understates every entry by the grace window."""
        configure(
            self.tenant, {"day_window": {"start": "08:00", "end": "14:00", "grace_minutes": 10}}
        )
        with tenant_context(self.tenant.id):
            self.assertEqual(calendar.late_minutes(datetime.time(8, 25)), 25)

    def test_an_early_arrival_is_never_negative(self) -> None:
        with tenant_context(self.tenant.id):
            self.assertEqual(calendar.late_minutes(datetime.time(7, 30)), 0)

    def test_leaving_before_the_day_ends_is_an_early_departure(self) -> None:
        configure(self.tenant, {"day_window": {"start": "08:00", "end": "14:00"}})
        with tenant_context(self.tenant.id):
            self.assertEqual(calendar.early_departure_minutes(datetime.time(13, 30)), 30)
            self.assertEqual(calendar.early_departure_minutes(datetime.time(14, 30)), 0)

    def test_a_partial_window_keeps_the_other_defaults(self) -> None:
        """Setting only the grace must not silently lose the start and end."""
        configure(self.tenant, {"day_window": {"grace_minutes": 0}})
        with tenant_context(self.tenant.id):
            window = calendar.day_window()
            self.assertEqual(window.start, calendar.DEFAULT_DAY_WINDOW.start)
            self.assertEqual(window.end, calendar.DEFAULT_DAY_WINDOW.end)
            self.assertEqual(window.grace_minutes, 0)


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
