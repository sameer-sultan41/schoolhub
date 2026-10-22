"""Periods — HTTP endpoint round trips and `?ordering=` on `/periods`."""

from __future__ import annotations

import datetime

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status

from apps.timetable.models import Period, SlotStatus
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import (
    CampusFactory,
    PeriodFactory,
    StaffFactory,
    TeacherSubstitutionFactory,
    UserFactory,
    authenticate,
    grant,
    period_window,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class PeriodEndpointTests(TimetableAPITestCase):
    def _payload(self, **overrides) -> dict:
        base = {"name": "Period 9", "sequence": 90, "start_time": "18:00", "end_time": "18:45"}
        base.update(overrides)
        return base

    def test_creating_a_tenant_wide_period(self) -> None:
        self.allow("timetable.period.create")

        response = self.client.post("/api/v1/periods", self._payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertIsNone(response.json()["data"]["campus_id"])

    def test_an_overlapping_period_is_a_domain_rule_violation(self) -> None:
        """§11 — the rule `services.assert_period_does_not_overlap` owns."""
        self.allow("timetable.period.create")
        start, end = period_window(1)

        response = self.client.post(
            "/api/v1/periods",
            self._payload(sequence=91, start_time=start.isoformat(), end_time=end.isoformat()),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("start_time", fields)

    def test_a_campus_period_still_clashes_with_a_tenant_wide_one(self) -> None:
        """A tenant-wide period applies to this campus too, so it must be compared."""
        self.allow("timetable.period.create")
        start, end = period_window(2)

        response = self.client.post(
            "/api/v1/periods",
            self._payload(
                sequence=92,
                campus_id=str(self.campus.pk),
                start_time=start.isoformat(),
                end_time=end.isoformat(),
            ),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_tenant_wide_period_clashes_with_any_campus_one(self) -> None:
        """The other direction: a tenant-wide period applies to every campus."""
        self.allow("timetable.period.create")
        with tenant_context(self.tenant.id):
            PeriodFactory(
                tenant=self.tenant,
                campus=self.campus,
                sequence=93,
                start_time=datetime.time(19, 0),
                end_time=datetime.time(19, 45),
            )

        response = self.client.post(
            "/api/v1/periods",
            self._payload(sequence=94, start_time="19:15", end_time="20:00"),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_an_end_time_before_the_start_is_a_field_error(self) -> None:
        """Mirrors `periods_end_after_start` so the form gets a field, not a 409."""
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods",
            self._payload(start_time="18:00", end_time="17:00"),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        fields = {detail["field"] for detail in response.json()["error"]["details"]}
        self.assertIn("end_time", fields)

    def test_weekdays_must_be_day_numbers(self) -> None:
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods", self._payload(weekdays={"mon": True}), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_weekdays_out_of_range_are_rejected(self) -> None:
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods", self._payload(weekdays=[0, 1, 9]), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_repeated_weekdays_are_rejected(self) -> None:
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods", self._payload(weekdays=[1, 1]), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_a_valid_weekday_list_is_accepted(self) -> None:
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods", self._payload(weekdays=[0, 1, 2, 3, 4]), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["weekdays"], [0, 1, 2, 3, 4])

    def test_marking_a_period_as_a_break(self) -> None:
        self.allow("timetable.period.create", "timetable.timetable.view")

        response = self.client.post("/api/v1/periods", self._payload(is_break=True), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertTrue(response.json()["data"]["is_break"])

    def test_patching_a_period_ignores_its_own_row_when_checking_overlap(self) -> None:
        """Without `exclude_pk` a period would always overlap itself and never be editable."""
        self.allow("timetable.period.update", "timetable.timetable.view")

        response = self.client.patch(
            f"/api/v1/periods/{self.period.pk}", {"name": "Renamed"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["name"], "Renamed")

    def test_deleting_a_period_is_a_soft_delete(self) -> None:
        self.allow("timetable.period.delete")
        with tenant_context(self.tenant.id):
            spare = PeriodFactory(tenant=self.tenant, sequence=93)

        response = self.client.delete(f"/api/v1/periods/{spare.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        with tenant_context(self.tenant.id):
            self.assertFalse(Period.objects.alive().filter(pk=spare.pk).exists())


class PeriodOrderingTests(TimetableAPITestCase):
    """`?ordering=` on `/periods`.

    The bell schedule is this module's worst case for the no-`__` rule: `get_queryset`
    hands a campus-scoped principal `(scoped | tenant_wide).distinct()`, and Postgres
    refuses `SELECT DISTINCT` with an `ORDER BY` on a joined column that is not in the
    select list. The last test here is the one that catches a `__` creeping back in.
    """

    def setUp(self) -> None:
        super().setUp()
        self.allow("timetable.timetable.view")
        with tenant_context(self.tenant.id):
            self.wing = CampusFactory(tenant=self.tenant, name="North Wing")
            self.zoology = PeriodFactory(
                tenant=self.tenant,
                campus=self.wing,
                name="Zoology",
                sequence=11,
                start_time=datetime.time(8, 0),
                end_time=datetime.time(8, 45),
                is_break=False,
                weekdays=[4],
            )
            self.algebra = PeriodFactory(
                tenant=self.tenant,
                campus=self.wing,
                name="Algebra",
                sequence=12,
                start_time=datetime.time(9, 0),
                end_time=datetime.time(9, 50),
                is_break=False,
                weekdays=[3],
            )
            self.recess = PeriodFactory(
                tenant=self.tenant,
                campus=self.wing,
                name="Recess",
                sequence=13,
                start_time=datetime.time(10, 0),
                end_time=datetime.time(10, 20),
                is_break=True,
                weekdays=[2],
            )

    def ids(self, query: str) -> list[str]:
        """`?campus_id=` excludes the fixture's tenant-wide periods, which is what makes
        the expected order a list of three rather than of seven."""
        response = self.client.get(f"/api/v1/periods?campus_id={self.wing.pk}&{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]

    def ascending(self) -> dict[str, tuple]:
        return {
            "sequence": (self.zoology, self.algebra, self.recess),
            "name": (self.algebra, self.recess, self.zoology),
            "start_time": (self.zoology, self.algebra, self.recess),
            "end_time": (self.zoology, self.algebra, self.recess),
        }

    def test_each_column_the_table_renders_sorts_ascending(self) -> None:
        for field, periods in self.ascending().items():
            with self.subTest(field=field):
                self.assertEqual(self.ids(f"ordering={field}"), [str(p.pk) for p in periods])

    def test_the_same_columns_sort_descending(self) -> None:
        for field, periods in self.ascending().items():
            with self.subTest(field=field):
                self.assertEqual(
                    self.ids(f"ordering=-{field}"), [str(p.pk) for p in reversed(periods)]
                )

    def test_is_break_sorts_the_break_to_either_end(self) -> None:
        """Two teaching periods share `False`, so only the break's position is pinned."""
        self.assertEqual(self.ids("ordering=is_break")[-1], str(self.recess.pk))
        self.assertEqual(self.ids("ordering=-is_break")[0], str(self.recess.pk))

    def test_a_campus_scoped_principal_can_sort_by_the_annotated_campus(self) -> None:
        """The `.distinct()` path, read by the principal it exists for.

        `campus__name` in `ordering_fields` would answer 200 for the all-scoped admin
        above and raise ProgrammingError for exactly this reader. Ordering is asserted
        as a set because all three campus periods share one campus name and the pk
        tiebreak decides between them; what is pinned is that the named campus sorts
        ahead of the tenant-wide rows, whose `campus_name` is NULL.
        """
        user = UserFactory(tenant=self.tenant)
        grant(
            user,
            "timetable.timetable.view",
            scope=RecordScope.CAMPUS,
            scope_ref=self.wing.pk,
        )
        authenticate(self.client, user)

        response = self.client.get("/api/v1/periods?ordering=campus_name")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        ids = [row["id"] for row in response.json()["data"]]
        self.assertEqual(len(ids), 3 + len(self.periods))
        self.assertEqual(
            set(ids[:3]),
            {str(self.zoology.pk), str(self.algebra.pk), str(self.recess.pk)},
        )

    def test_an_undeclared_column_is_ignored_rather_than_an_error(self) -> None:
        """`weekdays` is an array; there is no ordering of it a reader would recognise
        as the one the header promises, so it is left out of the allowlist. Honouring
        it would reverse this list — the answer is the view's own default instead."""
        self.assertEqual(
            self.ids("ordering=weekdays"),
            [str(self.zoology.pk), str(self.algebra.pk), str(self.recess.pk)],
        )


class PeriodCampusTests(TimetableAPITestCase):
    """`campus_name` on the wire, and `?for_campus=`: the periods that run at one campus."""

    def setUp(self) -> None:
        super().setUp()
        self.allow("timetable.timetable.view")
        with tenant_context(self.tenant.id):
            self.wing = CampusFactory(tenant=self.tenant, name="North Wing")
            self.elsewhere = CampusFactory(tenant=self.tenant, name="South Wing")
            self.wing_period = PeriodFactory(
                tenant=self.tenant,
                campus=self.wing,
                sequence=21,
                start_time=datetime.time(18, 0),
                end_time=datetime.time(18, 30),
            )
            self.elsewhere_period = PeriodFactory(
                tenant=self.tenant,
                campus=self.elsewhere,
                sequence=22,
                start_time=datetime.time(18, 0),
                end_time=datetime.time(18, 30),
            )

    def test_for_campus_is_the_campus_own_periods_plus_the_tenant_wide_ones(self) -> None:
        response = self.client.get(f"/api/v1/periods?for_campus={self.wing.pk}&page_size=100")

        ids = {row["id"] for row in response.json()["data"]}
        expected = {str(period.pk) for period in self.periods} | {str(self.wing_period.pk)}
        self.assertEqual(ids, expected)

    def test_campus_id_keeps_its_exact_match_meaning(self) -> None:
        response = self.client.get(f"/api/v1/periods?campus_id={self.wing.pk}")

        ids = [row["id"] for row in response.json()["data"]]
        self.assertEqual(ids, [str(self.wing_period.pk)])

    def test_each_row_names_its_campus_and_a_tenant_wide_row_names_none(self) -> None:
        rows = {
            row["id"]: row["campus_name"]
            for row in self.client.get(
                f"/api/v1/periods?for_campus={self.wing.pk}&page_size=100"
            ).json()["data"]
        }

        self.assertEqual(rows[str(self.wing_period.pk)], "North Wing")
        self.assertIsNone(rows[str(self.period.pk)])

    def test_a_create_response_names_the_campus_too(self) -> None:
        """The create response serializes an instance the list's annotation never touched."""
        self.allow("timetable.period.create")

        response = self.client.post(
            "/api/v1/periods",
            {
                "name": "Evening",
                "sequence": 95,
                "campus_id": str(self.wing.pk),
                "start_time": "19:00",
                "end_time": "19:30",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        self.assertEqual(response.json()["data"]["campus_name"], "North Wing")

    def test_the_list_query_count_does_not_grow_with_the_rows(self) -> None:
        """`campus_name` reads through `select_related`, not a query per row."""

        def queries() -> int:
            with CaptureQueriesContext(connection) as captured:
                self.client.get("/api/v1/periods?page_size=100")
            return len(captured)

        queries()  # warm any per-request caches (feature flag, permissions)
        before = queries()
        with tenant_context(self.tenant.id):
            for offset in range(5):
                PeriodFactory(
                    tenant=self.tenant,
                    campus=CampusFactory(tenant=self.tenant),
                    sequence=30 + offset,
                    start_time=datetime.time(20, offset * 10),
                    end_time=datetime.time(20, offset * 10 + 5),
                )

        self.assertEqual(queries(), before)


class PeriodDeleteGuardTests(TimetableAPITestCase):
    """A removal is a soft delete, which `on_delete=PROTECT` never sees, so the
    in-use rule lives in `services.assert_period_not_in_use`."""

    def setUp(self) -> None:
        super().setUp()
        self.allow("timetable.period.delete")

    def assert_still_alive(self, period) -> None:
        with tenant_context(self.tenant.id):
            self.assertTrue(Period.objects.alive().filter(pk=period.pk).exists())

    def test_a_period_a_current_cell_runs_on_is_refused(self) -> None:
        self.make_slot(period=self.period)

        response = self.client.delete(f"/api/v1/periods/{self.period.pk}")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("still on a timetable", response.json()["error"]["message"])
        self.assert_still_alive(self.period)

    def test_a_period_only_superseded_cells_used_can_go(self) -> None:
        self.make_slot(
            period=self.period,
            status=SlotStatus.PUBLISHED,
            effective_from=datetime.date(2026, 4, 1),
            effective_to=datetime.date(2026, 4, 2),
        )

        response = self.client.delete(f"/api/v1/periods/{self.period.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

    def test_a_period_upcoming_cover_runs_on_is_refused(self) -> None:
        slot = self.make_slot(
            period=self.period,
            status=SlotStatus.PUBLISHED,
            effective_from=datetime.date(2026, 4, 1),
            effective_to=datetime.date(2026, 4, 2),
        )
        with tenant_context(self.tenant.id):
            cover = StaffFactory(tenant=self.tenant, campus=self.campus)
            TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=slot,
                date=timezone.localdate() + datetime.timedelta(days=7),
                absent_staff=self.teacher,
                substitute_staff=cover,
            )

        response = self.client.delete(f"/api/v1/periods/{self.period.pk}")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assert_still_alive(self.period)
