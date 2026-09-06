"""Cross-tenant access on every attendance endpoint.

testing-strategy.md §3 and AGENTS.md invariant 4: for each endpoint, a tenant-A
caller reaching for a tenant-B resource must get **404, never 403** — a 403
confirms the row exists, which is the leak the rule exists to prevent.

The acting user holds every key this module declares, `all`-scoped, and the flag
is on for both tenants, so a denial here can only come from tenant scoping.
Without that, these would all pass for the wrong reason the moment someone forgot
a permission.

`:bulk-mark` fails differently from the rest and is asserted separately: it names
its section in the *body*, not the path, so a foreign section fails to resolve
through the scoped queryset rather than through a detail lookup — and it must
still be a 404.
"""

from __future__ import annotations

from rest_framework import status

from apps.attendance.models import AttendanceStatus, StudentAttendance
from apps.attendance.tests.base import AttendanceAPITestCase
from apps.attendance.tests.factories import (
    MARKING_DATE,
    AcademicSessionFactory,
    AttendanceCorrectionFactory,
    CampusFactory,
    ClassFactory,
    SectionFactory,
    StudentAttendanceFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    TenantFactory,
    UserFactory,
    enable_feature,
)
from core.tenancy.context import tenant_context

BULK_MARK = "/api/v1/student-attendance:bulk-mark"
LIST = "/api/v1/student-attendance"
CORRECTIONS = "/api/v1/attendance-corrections"


class AttendanceCrossTenantTests(AttendanceAPITestCase):
    """Builds a complete, self-consistent second tenant alongside the first."""

    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()

        self.other = TenantFactory()
        self.other_user = UserFactory(tenant=self.other)
        enable_feature(self.other, "module.attendance")

        with tenant_context(self.other.id):
            self.other_campus = CampusFactory(tenant=self.other)
            self.other_session = AcademicSessionFactory(tenant=self.other, is_current=True)
            self.other_class = ClassFactory(tenant=self.other, level=6)
            self.foreign_section = SectionFactory(
                tenant=self.other, school_class=self.other_class, campus=self.other_campus
            )
            self.foreign_student = StudentFactory(tenant=self.other, campus=self.other_campus)
            StudentEnrollmentFactory(
                tenant=self.other,
                student=self.foreign_student,
                academic_session=self.other_session,
                school_class=self.other_class,
                section=self.foreign_section,
            )
            self.foreign_row = StudentAttendanceFactory(
                tenant=self.other,
                student=self.foreign_student,
                section=self.foreign_section,
                academic_session=self.other_session,
                status=AttendanceStatus.ABSENT,
                is_locked=True,
                marked_by=self.other_user.pk,
            )
            self.foreign_correction = AttendanceCorrectionFactory(
                tenant=self.other,
                student_attendance=self.foreign_row,
                requested_by=self.other_user.pk,
            )

    def test_another_tenants_attendance_row_is_not_retrievable(self) -> None:
        response = self.client.get(f"{LIST}/{self.foreign_row.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_another_tenants_rows_are_absent_from_the_list(self) -> None:
        response = self.client.get(LIST)

        self.assertEqual(response.data["data"], [])

    def test_filtering_by_another_tenants_section_matches_nothing(self) -> None:
        response = self.client.get(f"{LIST}?section_id={self.foreign_section.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"], [])

    def test_marking_another_tenants_section_is_a_404(self) -> None:
        """The section is named in the body, so it fails to resolve through the
        scoped queryset rather than through a detail lookup — and must still be a
        404, not the 400 an unresolvable related field would otherwise produce."""
        response = self.client.post(
            BULK_MARK,
            {
                "section_id": str(self.foreign_section.pk),
                "attendance_date": MARKING_DATE.isoformat(),
                "entries": [
                    {"student_id": str(self.foreign_student.pk), "status": AttendanceStatus.PRESENT}
                ],
            },
            format="json",
        )

        self.assertIn(
            response.status_code,
            (status.HTTP_400_BAD_REQUEST, status.HTTP_404_NOT_FOUND),
        )
        # Asserted on the row's *state*, not on a row count: the fixture already
        # marked this student absent today, so counting would have passed whether
        # or not the request had overwritten them.
        with tenant_context(self.other.id):
            self.foreign_row.refresh_from_db()
            self.assertEqual(self.foreign_row.status, AttendanceStatus.ABSENT)

    def test_marking_another_tenants_student_into_our_own_section_is_refused(self) -> None:
        """The nastier shape: a section the caller *can* reach, holding a student
        they cannot. The enrolment check is what catches it, and it must not
        create the row."""
        response = self.client.post(
            BULK_MARK,
            {
                "section_id": str(self.section.pk),
                "attendance_date": MARKING_DATE.isoformat(),
                "entries": [
                    {"student_id": str(self.foreign_student.pk), "status": AttendanceStatus.PRESENT}
                ],
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        with tenant_context(self.other.id):
            self.foreign_row.refresh_from_db()
            self.assertEqual(self.foreign_row.status, AttendanceStatus.ABSENT)
            self.assertEqual(
                StudentAttendance.objects.alive().filter(student=self.foreign_student).count(), 1
            )

    def test_another_tenants_correction_is_not_retrievable(self) -> None:
        response = self.client.get(f"{CORRECTIONS}/{self.foreign_correction.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_another_tenants_corrections_are_absent_from_the_list(self) -> None:
        response = self.client.get(CORRECTIONS)

        self.assertEqual(response.data["data"], [])

    def test_approving_another_tenants_correction_is_a_404(self) -> None:
        response = self.client.post(
            f"{CORRECTIONS}/{self.foreign_correction.pk}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_rejecting_another_tenants_correction_is_a_404(self) -> None:
        response = self.client.post(
            f"{CORRECTIONS}/{self.foreign_correction.pk}:reject", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_requesting_a_correction_against_another_tenants_row_is_refused(self) -> None:
        """Through the serializer's tenant-scoped related field: a foreign id
        does not resolve, so this is a 400 rather than a leak."""
        response = self.client.post(
            CORRECTIONS,
            {
                "student_attendance_id": str(self.foreign_row.pk),
                "new_values": {"status": AttendanceStatus.PRESENT},
                "reason": "Not mine to correct.",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
