"""Cross-tenant access on every timetable endpoint class.

testing-strategy.md §3 and AGENTS.md invariant 4: for each endpoint, a tenant-A
caller reaching for a tenant-B resource must get **404, never 403** — a 403
confirms the row exists, which is the leak the rule exists to prevent.

The acting user is granted every key in the module and the module flag is on for
both tenants, so a denial here can only come from tenant scoping. Without that,
these would all pass for the wrong reason the moment someone forgot a permission.

`/timetables/my` gets its own class: it is the one endpoint a student or guardian
reaches, it resolves *whose* timetable to serve from the caller rather than from a
path id, and so it fails differently — silently, by resolving nothing, rather than
with a 404.
"""

from __future__ import annotations

import uuid

from rest_framework import status

from apps.timetable.models import SlotStatus
from apps.timetable.tests.base import TimetableAPITestCase
from apps.timetable.tests.factories import (
    MONDAY,
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    GuardianFactory,
    PeriodFactory,
    RoomFactory,
    SectionFactory,
    StaffFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    SubjectFactory,
    TeacherAllocationFactory,
    TeacherSubstitutionFactory,
    TenantFactory,
    TimetableSlotFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)
from core.tenancy.context import tenant_context


class TimetableCrossTenantTestCase(TimetableAPITestCase):
    """Builds a complete, self-consistent second tenant alongside the first."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()

        self.other = TenantFactory()
        enable_feature(self.other, "module.timetable")
        with tenant_context(self.other.id):
            self.other_campus = CampusFactory(tenant=self.other)
            self.other_session = AcademicSessionFactory(tenant=self.other, is_current=True)
            other_class = ClassFactory(tenant=self.other, level=6)
            self.other_tenant_section = SectionFactory(
                tenant=self.other, school_class=other_class, campus=self.other_campus
            )
            self.other_subject = SubjectFactory(tenant=self.other)
            ClassSubjectFactory(
                tenant=self.other,
                academic_session=self.other_session,
                school_class=other_class,
                subject=self.other_subject,
            )
            self.other_staff = StaffFactory(tenant=self.other, campus=self.other_campus)
            TeacherAllocationFactory(
                tenant=self.other,
                academic_session=self.other_session,
                section=self.other_tenant_section,
                subject=self.other_subject,
                staff=self.other_staff,
            )
            self.other_period = PeriodFactory(tenant=self.other, sequence=1)
            self.other_room = RoomFactory(tenant=self.other, campus=self.other_campus)
            self.other_slot = TimetableSlotFactory(
                tenant=self.other,
                academic_session=self.other_session,
                section=self.other_tenant_section,
                period=self.other_period,
                subject=self.other_subject,
                staff=self.other_staff,
                room=self.other_room,
                day_of_week=0,
                status=SlotStatus.PUBLISHED,
            )
            self.other_cover = StaffFactory(tenant=self.other, campus=self.other_campus)
            self.other_substitution = TeacherSubstitutionFactory(
                tenant=self.other,
                timetable_slot=self.other_slot,
                date=MONDAY,
                absent_staff=self.other_staff,
                substitute_staff=self.other_cover,
            )


class DetailReadTests(TimetableCrossTenantTestCase):
    def test_reading_another_tenants_room_is_404(self) -> None:
        self.assertEqual(
            self.client.get(f"/api/v1/rooms/{self.other_room.pk}").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_reading_another_tenants_period_is_404(self) -> None:
        self.assertEqual(
            self.client.get(f"/api/v1/periods/{self.other_period.pk}").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_reading_another_tenants_slot_is_404(self) -> None:
        self.assertEqual(
            self.client.get(f"/api/v1/timetable-slots/{self.other_slot.pk}").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_reading_another_tenants_substitution_is_404(self) -> None:
        self.assertEqual(
            self.client.get(
                f"/api/v1/teacher-substitutions/{self.other_substitution.pk}"
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )


class ListLeakageTests(TimetableCrossTenantTestCase):
    def test_no_list_ever_contains_another_tenants_rows(self) -> None:
        rooms = {row["id"] for row in self.client.get("/api/v1/rooms").json()["data"]}
        periods = {row["id"] for row in self.client.get("/api/v1/periods").json()["data"]}
        slots = {row["id"] for row in self.client.get("/api/v1/timetable-slots").json()["data"]}
        subs = {
            row["id"] for row in self.client.get("/api/v1/teacher-substitutions").json()["data"]
        }

        self.assertNotIn(str(self.other_room.pk), rooms)
        self.assertNotIn(str(self.other_period.pk), periods)
        self.assertNotIn(str(self.other_slot.pk), slots)
        self.assertNotIn(str(self.other_substitution.pk), subs)

    def test_filtering_by_another_tenants_id_returns_nothing(self) -> None:
        """A filter is not a back door: the scoped queryset applies first."""
        by_section = self.client.get(
            f"/api/v1/timetable-slots?section_id={self.other_tenant_section.pk}"
        )
        by_teacher = self.client.get(f"/api/v1/timetable-slots?teacher_id={self.other_staff.pk}")
        by_campus = self.client.get(f"/api/v1/rooms?campus_id={self.other_campus.pk}")

        self.assertEqual(by_section.json()["data"], [])
        self.assertEqual(by_teacher.json()["data"], [])
        self.assertEqual(by_campus.json()["data"], [])

    def test_filtering_substitutions_by_another_tenants_staff_returns_nothing(self) -> None:
        response = self.client.get(
            f"/api/v1/teacher-substitutions?substitute_staff_id={self.other_cover.pk}"
        )

        self.assertEqual(response.json()["data"], [])


class ForeignIdSmugglingTests(TimetableCrossTenantTestCase):
    """A write naming a foreign id must fail at resolution, before authorization.

    400, not 403 or 404-on-the-child: the tenant-scoped queryset behind each
    `PrimaryKeyRelatedField` cannot see the row at all, so it never becomes a
    permission question in the first place.
    """

    def test_creating_a_room_on_another_tenants_campus_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/rooms",
            {"campus_id": str(self.other_campus.pk), "name": "Smuggled", "code": "SMG1"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_creating_a_period_on_another_tenants_campus_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/periods",
            {
                "campus_id": str(self.other_campus.pk),
                "name": "Smuggled",
                "sequence": 80,
                "start_time": "19:00",
                "end_time": "19:45",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_creating_a_slot_in_another_tenants_section_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/timetable-slots",
            {
                "academic_session_id": str(self.session.pk),
                "section_id": str(self.other_tenant_section.pk),
                "day_of_week": 0,
                "period_id": str(self.period.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_scheduling_another_tenants_teacher_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/timetable-slots",
            {
                "academic_session_id": str(self.session.pk),
                "section_id": str(self.section.pk),
                "day_of_week": 0,
                "period_id": str(self.period.pk),
                "subject_id": str(self.subject.pk),
                "staff_id": str(self.other_staff.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_booking_another_tenants_room_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/timetable-slots",
            {
                "academic_session_id": str(self.session.pk),
                "section_id": str(self.section.pk),
                "day_of_week": 0,
                "period_id": str(self.period.pk),
                "room_id": str(self.other_room.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_using_another_tenants_period_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/timetable-slots",
            {
                "academic_session_id": str(self.session.pk),
                "section_id": str(self.section.pk),
                "day_of_week": 0,
                "period_id": str(self.other_period.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patching_a_slot_onto_another_tenants_room_is_rejected(self) -> None:
        slot = self.make_slot()

        response = self.client.patch(
            f"/api/v1/timetable-slots/{slot.pk}",
            {"room_id": str(self.other_room.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_patching_a_room_onto_another_tenants_campus_is_rejected(self) -> None:
        response = self.client.patch(
            f"/api/v1/rooms/{self.room.pk}",
            {"campus_id": str(self.other_campus.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_proposing_cover_on_another_tenants_slot_is_rejected(self) -> None:
        response = self.client.post(
            "/api/v1/teacher-substitutions",
            {
                "timetable_slot_id": str(self.other_slot.pk),
                "date": MONDAY.isoformat(),
                "absent_staff_id": str(self.other_staff.pk),
                "substitute_staff_id": str(self.other_cover.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_naming_another_tenants_substitute_for_an_own_slot_is_rejected(self) -> None:
        slot = self.publish(self.make_slot())

        response = self.client.post(
            "/api/v1/teacher-substitutions",
            {
                "timetable_slot_id": str(slot.pk),
                "date": MONDAY.isoformat(),
                "absent_staff_id": str(self.teacher.pk),
                "substitute_staff_id": str(self.other_cover.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_validating_against_another_tenants_session_is_rejected(self) -> None:
        response = self.client.post(
            f"/api/v1/timetables/{self.section.pk}:validate",
            {"academic_session_id": str(self.other_session.pk)},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class MutationOnForeignRowTests(TimetableCrossTenantTestCase):
    def test_patching_another_tenants_room_is_404(self) -> None:
        response = self.client.patch(
            f"/api/v1/rooms/{self.other_room.pk}", {"capacity": 1}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_another_tenants_room_is_404(self) -> None:
        self.assertEqual(
            self.client.delete(f"/api/v1/rooms/{self.other_room.pk}").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_patching_another_tenants_period_is_404(self) -> None:
        response = self.client.patch(
            f"/api/v1/periods/{self.other_period.pk}", {"name": "Renamed"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_another_tenants_period_is_404(self) -> None:
        self.assertEqual(
            self.client.delete(f"/api/v1/periods/{self.other_period.pk}").status_code,
            status.HTTP_404_NOT_FOUND,
        )

    def test_patching_another_tenants_slot_is_404(self) -> None:
        """404 even though the row is published, which would otherwise be a 409."""
        response = self.client.patch(
            f"/api/v1/timetable-slots/{self.other_slot.pk}", {"notes": "x"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_deleting_another_tenants_slot_is_404(self) -> None:
        self.assertEqual(
            self.client.delete(f"/api/v1/timetable-slots/{self.other_slot.pk}").status_code,
            status.HTTP_404_NOT_FOUND,
        )


class ColonActionTests(TimetableCrossTenantTestCase):
    def test_validating_another_tenants_section_is_404(self) -> None:
        response = self.client.post(
            f"/api/v1/timetables/{self.other_tenant_section.pk}:validate", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_publishing_another_tenants_section_is_404(self) -> None:
        response = self.client.post(
            f"/api/v1/timetables/{self.other_tenant_section.pk}:publish", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)
        with tenant_context(self.other.id):
            self.other_slot.refresh_from_db()
        self.assertIsNone(self.other_slot.effective_to, "the foreign grid must be untouched")

    def test_deciding_another_tenants_substitution_is_404(self) -> None:
        for verb in ("approve", "reject"):
            with self.subTest(verb=verb):
                response = self.client.post(
                    f"/api/v1/teacher-substitutions/{self.other_substitution.pk}:{verb}",
                    {},
                    format="json",
                )
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_unknown_id_is_indistinguishable_from_a_foreign_one(self) -> None:
        """Which is the point: 404 either way tells the caller nothing about existence."""
        stray = uuid.uuid4()

        self.assertEqual(
            self.client.post(f"/api/v1/timetables/{stray}:publish", {}, format="json").status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            self.client.post(
                f"/api/v1/teacher-substitutions/{stray}:approve", {}, format="json"
            ).status_code,
            status.HTTP_404_NOT_FOUND,
        )


class MyTimetableCrossTenantTests(TimetableCrossTenantTestCase):
    """`/timetables/my` resolves the caller, so a foreign row is simply never reached."""

    def test_a_teacher_never_sees_another_tenants_slots(self) -> None:
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.teacher.user_id = user.pk
            self.teacher.save(update_fields=["user_id"])
        # The same user id also attached to a staff row in the other tenant is
        # the shape that would leak if resolution ignored tenancy.
        with tenant_context(self.other.id):
            self.other_staff.user_id = user.pk
            self.other_staff.save(update_fields=["user_id"])
        self.publish(self.make_slot())
        grant(user, "timetable.timetable.view")
        authenticate(self.client, user)

        rows = self.client.get("/api/v1/timetables/my").json()["data"]

        self.assertNotIn(str(self.other_slot.pk), {row["id"] for row in rows})
        self.assertEqual(len(rows), 1)

    def test_a_guardian_never_sees_another_tenants_child_grid(self) -> None:
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.other.id):
            foreign_student = StudentFactory(tenant=self.other, campus=self.other_campus)
            StudentEnrollmentFactory(
                tenant=self.other,
                student=foreign_student,
                academic_session=self.other_session,
                school_class=self.other_tenant_section.school_class,
                section=self.other_tenant_section,
            )
            foreign_guardian = GuardianFactory(tenant=self.other, user_id=user.pk)
            StudentGuardianFactory(
                tenant=self.other, student=foreign_student, guardian=foreign_guardian
            )
        grant(user, "timetable.timetable.view", is_restricted_principal=True)
        authenticate(self.client, user)

        response = self.client.get("/api/v1/timetables/my")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], [])

    def test_naming_another_tenants_session_yields_nothing(self) -> None:
        user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.teacher.user_id = user.pk
            self.teacher.save(update_fields=["user_id"])
        self.publish(self.make_slot())
        grant(user, "timetable.timetable.view")
        authenticate(self.client, user)

        response = self.client.get(
            f"/api/v1/timetables/my?academic_session_id={self.other_session.pk}"
        )

        # The unresolvable session falls back to the caller's own current one
        # rather than reaching across the boundary; either way, nothing foreign
        # can appear.
        ids = {row["id"] for row in response.json()["data"]}
        self.assertNotIn(str(self.other_slot.pk), ids)


class PositiveControlTests(TimetableCrossTenantTestCase):
    """Without these, every assertion above could pass for the wrong reason."""

    def test_the_same_routes_succeed_for_the_callers_own_records(self) -> None:
        slot = self.make_slot()

        self.assertEqual(
            self.client.get(f"/api/v1/rooms/{self.room.pk}").status_code, status.HTTP_200_OK
        )
        self.assertEqual(
            self.client.get(f"/api/v1/periods/{self.period.pk}").status_code, status.HTTP_200_OK
        )
        self.assertEqual(
            self.client.get(f"/api/v1/timetable-slots/{slot.pk}").status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            self.client.post(
                f"/api/v1/timetables/{self.section.pk}:validate", {}, format="json"
            ).status_code,
            status.HTTP_200_OK,
        )

    def test_the_callers_own_writes_still_go_through(self) -> None:
        created = self.client.post(
            "/api/v1/rooms",
            {"campus_id": str(self.campus.pk), "name": "Own room", "code": "OWN1"},
            format="json",
        )
        slot = self.client.post(
            "/api/v1/timetable-slots",
            {
                "academic_session_id": str(self.session.pk),
                "section_id": str(self.section.pk),
                "day_of_week": 0,
                "period_id": str(self.period.pk),
                "subject_id": str(self.subject.pk),
                "staff_id": str(self.teacher.pk),
            },
            format="json",
        )

        self.assertEqual(created.status_code, status.HTTP_201_CREATED, created.json())
        self.assertEqual(slot.status_code, status.HTTP_201_CREATED, slot.json())

    def test_the_callers_own_substitution_can_be_decided(self) -> None:
        published = self.publish(self.make_slot())
        with tenant_context(self.tenant.id):
            cover = StaffFactory(tenant=self.tenant, campus=self.campus)
            substitution = TeacherSubstitutionFactory(
                tenant=self.tenant,
                timetable_slot=published,
                date=MONDAY,
                absent_staff=self.teacher,
                substitute_staff=cover,
            )

        response = self.client.post(
            f"/api/v1/teacher-substitutions/{substitution.pk}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
