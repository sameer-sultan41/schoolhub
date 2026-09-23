"""Rooms — HTTP endpoint round trips.

URLs are literal strings, not ``reverse()`` — the URL *is* the contract (see
apps/staff_management/designations/tests/test_endpoints.py's identical
convention).
"""

from __future__ import annotations

from rest_framework import status

from apps.timetable.models import Room
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import CampusFactory, RoomFactory
from core.tenancy.context import tenant_context


class RoomEndpointTests(TimetableAPITestCase):
    def test_listing_requires_the_timetable_view_key(self) -> None:
        """§4 declares no `timetable.room.view`; the timetable key stands in."""
        self.assertEqual(self.client.get("/api/v1/rooms").status_code, status.HTTP_403_FORBIDDEN)

        self.allow("timetable.timetable.view")
        self.assertEqual(self.client.get("/api/v1/rooms").status_code, status.HTTP_200_OK)

    def test_creating_a_room_needs_the_create_key_not_the_view_one(self) -> None:
        self.allow("timetable.timetable.view")
        payload = {"campus_id": str(self.campus.pk), "name": "Lab 1", "code": "LAB1"}

        self.assertEqual(
            self.client.post("/api/v1/rooms", payload, format="json").status_code,
            status.HTTP_403_FORBIDDEN,
        )

        self.allow("timetable.room.create")
        response = self.client.post("/api/v1/rooms", payload, format="json")
        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        with tenant_context(self.tenant.id):
            self.assertTrue(Room.objects.alive().filter(code="LAB1").exists())

    def test_a_room_that_seats_nobody_is_rejected(self) -> None:
        """Capacity 0 is storable in a PositiveSmallIntegerField and meaningless."""
        self.allow("timetable.room.create")

        response = self.client.post(
            "/api/v1/rooms",
            {"campus_id": str(self.campus.pk), "name": "Void", "code": "VOID", "capacity": 0},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patching_a_rooms_capacity(self) -> None:
        self.allow("timetable.room.update", "timetable.timetable.view")

        response = self.client.patch(
            f"/api/v1/rooms/{self.room.pk}", {"capacity": 25}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["capacity"], 25)

    def test_deleting_a_room_is_a_soft_delete(self) -> None:
        self.allow("timetable.room.delete")

        response = self.client.delete(f"/api/v1/rooms/{self.room.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        with tenant_context(self.tenant.id):
            self.assertFalse(Room.objects.alive().filter(pk=self.room.pk).exists())
            self.assertTrue(Room.objects.filter(pk=self.room.pk).exists())

    def test_rooms_filter_by_campus_and_type(self) -> None:
        self.allow("timetable.timetable.view")
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            RoomFactory(tenant=self.tenant, campus=other_campus)
            lab = RoomFactory(tenant=self.tenant, campus=self.campus, room_type="lab")

        by_campus = self.client.get(f"/api/v1/rooms?campus_id={self.campus.pk}").json()["data"]
        by_type = self.client.get("/api/v1/rooms?room_type=lab").json()["data"]

        self.assertEqual(len(by_campus), 2)
        self.assertEqual([row["id"] for row in by_type], [str(lab.pk)])


class RoomOrderingTests(TimetableAPITestCase):
    """`?ordering=` on `/rooms` — the sorts the room table's own headers issue.

    Every row is built on a campus of its own and read back through `?campus_id=`, so
    the base fixture's room — whose factory-sequenced code is not predictable — cannot
    land in the middle of an expected order.
    """

    def setUp(self) -> None:
        super().setUp()
        self.allow("timetable.timetable.view")
        with tenant_context(self.tenant.id):
            self.wing = CampusFactory(tenant=self.tenant, name="North Wing")
            self.lab = RoomFactory(
                tenant=self.tenant,
                campus=self.wing,
                code="A-1",
                name="Zoology Lab",
                room_type="lab",
                capacity=24,
                floor="3",
                is_active=True,
            )
            self.classroom = RoomFactory(
                tenant=self.tenant,
                campus=self.wing,
                code="B-2",
                name="Maths Room",
                room_type="classroom",
                capacity=None,
                floor="2",
                is_active=False,
            )
            self.hall = RoomFactory(
                tenant=self.tenant,
                campus=self.wing,
                code="C-3",
                name="Assembly Hall",
                room_type="auditorium",
                capacity=300,
                floor="1",
                is_active=True,
            )

    def ids(self, query: str) -> list[str]:
        response = self.client.get(f"/api/v1/rooms?campus_id={self.wing.pk}&{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]

    def ascending(self) -> dict[str, tuple]:
        return {
            "code": (self.lab, self.classroom, self.hall),
            "name": (self.hall, self.classroom, self.lab),
            "room_type": (self.hall, self.classroom, self.lab),
            # 24, then 300, then the room with no capacity recorded at all: `capacity`
            # is nullable and Postgres sorts NULL last ascending.
            "capacity": (self.lab, self.hall, self.classroom),
        }

    def test_each_column_the_table_renders_sorts_ascending(self) -> None:
        for field, rooms in self.ascending().items():
            with self.subTest(field=field):
                self.assertEqual(self.ids(f"ordering={field}"), [str(r.pk) for r in rooms])

    def test_the_same_columns_sort_descending(self) -> None:
        for field, rooms in self.ascending().items():
            with self.subTest(field=field):
                self.assertEqual(
                    self.ids(f"ordering=-{field}"), [str(r.pk) for r in reversed(rooms)]
                )

    def test_is_active_sorts_the_closed_room_to_either_end(self) -> None:
        """Two rooms share `True` and `StableOrderingFilter`'s pk tiebreak decides
        between them, so this pins the one position that is unambiguous."""
        self.assertEqual(self.ids("ordering=is_active")[0], str(self.classroom.pk))
        self.assertEqual(self.ids("ordering=-is_active")[-1], str(self.classroom.pk))

    def test_it_sorts_by_the_annotated_campus_name(self) -> None:
        """`campus__name` in `ordering_fields` would be the `__` traversal that
        `SELECT DISTINCT` cannot order by; the annotation is in the select list."""
        with tenant_context(self.tenant.id):
            west = CampusFactory(tenant=self.tenant, name="West Campus")
            east = CampusFactory(tenant=self.tenant, name="East Campus")
            in_west = RoomFactory(tenant=self.tenant, campus=west, room_type="library")
            in_east = RoomFactory(tenant=self.tenant, campus=east, room_type="library")

        response = self.client.get("/api/v1/rooms?room_type=library&ordering=campus_name")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(
            [row["id"] for row in response.json()["data"]],
            [str(in_east.pk), str(in_west.pk)],
        )

    def test_an_undeclared_column_is_ignored_rather_than_an_error(self) -> None:
        """`floor` is a real column deliberately left out of the allowlist — the client
        joins it with `building` into one display string, so sorting on it alone would
        order the rows by something other than what the header names. Sorting on it
        would put the hall first; the answer is the view's own default instead."""
        self.assertEqual(
            self.ids("ordering=floor"),
            [str(self.lab.pk), str(self.classroom.pk), str(self.hall.pk)],
        )
