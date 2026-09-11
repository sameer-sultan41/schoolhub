"""`?ordering=` on `/teacher-substitutions` — the vice principal's cover list."""

from __future__ import annotations

import datetime

from rest_framework import status

from apps.timetable.models import SubstitutionStatus
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import (
    MONDAY,
    TUESDAY,
    StaffFactory,
    TeacherSubstitutionFactory,
)
from core.tenancy.context import tenant_context


class TeacherSubstitutionOrderingTests(TimetableAPITestCase):
    """`?ordering=` on `/teacher-substitutions` — the vice principal's cover list."""

    WEDNESDAY = MONDAY + datetime.timedelta(days=2)

    def setUp(self) -> None:
        super().setUp()
        self.allow("timetable.timetable.view")
        slot = self.publish(self.make_slot())
        with tenant_context(self.tenant.id):
            raza = StaffFactory(tenant=self.tenant, campus=self.campus, last_name="Raza")
            sethi = StaffFactory(tenant=self.tenant, campus=self.campus, last_name="Sethi")
            qureshi = StaffFactory(tenant=self.tenant, campus=self.campus, last_name="Qureshi")
            zheng = StaffFactory(tenant=self.tenant, campus=self.campus, last_name="Zheng")
            # Three dates on one slot: `substitutions_one_per_slot_per_date` is the only
            # uniqueness in play, so this needs no second section or allocation.
            self.monday = TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=slot,
                date=MONDAY,
                absent_staff=zheng,
                substitute_staff=raza,
                status=SubstitutionStatus.PROPOSED,
                reason="Alpha",
            )
            self.tuesday = TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=slot,
                date=TUESDAY,
                absent_staff=qureshi,
                substitute_staff=sethi,
                status=SubstitutionStatus.CONFIRMED,
                reason="Bravo",
            )
            self.wednesday = TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=slot,
                date=self.WEDNESDAY,
                absent_staff=raza,
                substitute_staff=zheng,
                status=SubstitutionStatus.DECLINED,
                reason="Charlie",
            )

    def ids(self, query: str) -> list[str]:
        response = self.client.get(f"/api/v1/teacher-substitutions?{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]

    def ascending(self) -> dict[str, tuple]:
        return {
            "date": (self.monday, self.tuesday, self.wednesday),
            # confirmed, declined, proposed — the stored values, not the labels.
            "status": (self.tuesday, self.wednesday, self.monday),
            # Qureshi (tuesday), Raza (wednesday), Zheng (monday).
            "absent_staff_last_name": (self.tuesday, self.wednesday, self.monday),
            "substitute_staff_last_name": (self.monday, self.tuesday, self.wednesday),
        }

    def test_each_column_the_table_renders_sorts_ascending(self) -> None:
        """Both staff columns are annotations rather than `absent_staff__last_name`
        and `substitute_staff__last_name` — see the viewset for why that holds even
        where no scope produces a `.distinct()` yet."""
        for field, rows in self.ascending().items():
            with self.subTest(field=field):
                self.assertEqual(self.ids(f"ordering={field}"), [str(r.pk) for r in rows])

    def test_the_same_columns_sort_descending(self) -> None:
        for field, rows in self.ascending().items():
            with self.subTest(field=field):
                self.assertEqual(
                    self.ids(f"ordering=-{field}"), [str(r.pk) for r in reversed(rows)]
                )

    def test_an_undeclared_column_is_ignored_rather_than_an_error(self) -> None:
        """`reason` is free text nobody sorts a cover list by. Honouring it would put
        Monday first; the view's own `-date` default puts Wednesday there."""
        self.assertEqual(
            self.ids("ordering=reason"),
            [str(self.wednesday.pk), str(self.tuesday.pk), str(self.monday.pk)],
        )
