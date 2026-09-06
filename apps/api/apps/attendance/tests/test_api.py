"""The attendance endpoints — attendance.md §16.

Complements test_marking.py rather than repeating it: the rules themselves are
proved against the service there, and these assert the HTTP contract — status
codes, the envelope, permission gating, record scope through a real request, and
`Idempotency-Key` replay.
"""

from __future__ import annotations

import datetime

from rest_framework import status

from apps.attendance.models import AttendanceStatus, CorrectionStatus, StudentAttendance
from apps.attendance.tests.base import AttendanceAPITestCase
from apps.attendance.tests.factories import (
    MARKING_DATE,
    GuardianFactory,
    StudentGuardianFactory,
    UserFactory,
    authenticate,
    configure_academic,
    grant,
    holiday,
)
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

BULK_MARK = "/api/v1/student-attendance:bulk-mark"
LIST = "/api/v1/student-attendance"
CORRECTIONS = "/api/v1/attendance-corrections"


class BulkMarkEndpointTests(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()

    def payload(self, *, status_value=AttendanceStatus.PRESENT, **overrides) -> dict:
        return {
            "section_id": str(self.section.pk),
            "attendance_date": MARKING_DATE.isoformat(),
            "entries": [{"student_id": str(s.pk), "status": status_value} for s in self.students],
            **overrides,
        }

    def test_marking_a_register_returns_the_rows_and_the_counts(self) -> None:
        response = self.client.post(BULK_MARK, self.payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["data"]), 3)
        self.assertEqual(response.data["meta"]["marked"], 3)
        self.assertEqual(response.data["meta"]["updated"], 0)

    def test_the_session_defaults_to_the_current_one(self) -> None:
        """A school runs one session at a time; the register UI has no reason to
        carry its id around."""
        response = self.client.post(BULK_MARK, self.payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        with tenant_context(self.tenant.id):
            row = StudentAttendance.objects.alive().first()
            self.assertEqual(row.academic_session_id, self.session.pk)

    def test_a_holiday_is_refused_with_the_holidays_name(self) -> None:
        configure_academic(
            self.tenant, holidays=[holiday(MARKING_DATE.isoformat(), "Founders Day")]
        )

        response = self.client.post(BULK_MARK, self.payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("Founders Day", str(response.data["error"]))

    def test_a_rejected_row_comes_back_in_error_meta(self) -> None:
        """The structured-meta path `core.api.exceptions` carries, which
        `tests/test_api_contract.py` reserved naming this exact case: a client
        needs to know *which* rows failed to re-submit only those."""
        payload = self.payload()
        payload["entries"].append(
            {"student_id": str(self.students[0].pk), "status": AttendanceStatus.ABSENT}
        )

        response = self.client.post(BULK_MARK, payload, format="json")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("rows", response.data["error"]["meta"])

    def test_an_idempotency_key_replays_the_first_response(self) -> None:
        """§6's offline-tolerant re-submission. The upsert already makes a retry
        safe; this makes it *identical*, which is what a client comparing counts
        needs — a second call without the key would report 0 marked, 3 updated."""
        headers = {"HTTP_IDEMPOTENCY_KEY": "register-2026-04-06-6a"}

        first = self.client.post(BULK_MARK, self.payload(), format="json", **headers)
        second = self.client.post(BULK_MARK, self.payload(), format="json", **headers)

        self.assertEqual(first.data["meta"]["marked"], 3)
        self.assertEqual(second.data["meta"]["marked"], 3)
        self.assertEqual(second.data["meta"]["updated"], 0)

    def test_view_permission_alone_cannot_mark(self) -> None:
        reader = UserFactory(tenant=self.tenant)
        authenticate(self.client, reader)
        grant(reader, "attendance.student-attendance.view", scope=RecordScope.ALL)

        response = self.client.post(BULK_MARK, self.payload(), format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_register_may_not_be_posted_row_by_row(self) -> None:
        """§16 declares the list and `:bulk-mark`, nothing else. A per-row create
        would bypass the enrolment, calendar and duplicate checks."""
        response = self.client.post(
            LIST,
            {
                "student_id": str(self.students[0].pk),
                "section_id": str(self.section.pk),
                "academic_session_id": str(self.session.pk),
                "attendance_date": MARKING_DATE.isoformat(),
                "status": AttendanceStatus.PRESENT,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)


class StudentAttendanceListTests(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        self.client.post(
            BULK_MARK,
            {
                "section_id": str(self.section.pk),
                "attendance_date": MARKING_DATE.isoformat(),
                "entries": [
                    {"student_id": str(self.students[0].pk), "status": AttendanceStatus.ABSENT},
                    {"student_id": str(self.students[1].pk), "status": AttendanceStatus.PRESENT},
                    {"student_id": str(self.students[2].pk), "status": AttendanceStatus.PRESENT},
                ],
            },
            format="json",
        )

    def test_the_list_filters_by_status(self) -> None:
        response = self.client.get(f"{LIST}?status={AttendanceStatus.ABSENT}")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["data"]), 1)

    def test_the_list_filters_by_section(self) -> None:
        response = self.client.get(f"{LIST}?section_id={self.other_section.pk}")

        self.assertEqual(response.data["data"], [])

    def test_the_list_filters_by_a_date_range(self) -> None:
        """§16 names `date`, `date__gte` and `date__lte`; the column is
        `attendance_date`, so the wire name follows the doc and the field follows
        the schema."""
        after = (MARKING_DATE + datetime.timedelta(days=1)).isoformat()

        self.assertEqual(len(self.client.get(f"{LIST}?date={MARKING_DATE}").data["data"]), 3)
        self.assertEqual(len(self.client.get(f"{LIST}?date__gte={after}").data["data"]), 0)

    def test_an_unknown_section_id_matches_nothing_rather_than_erroring(self) -> None:
        """A filter narrows a list; it does not assert the value exists. An FK
        declared in `Meta.fields` would answer 400 here — and, under RLS, for the
        caller's own ids too."""
        response = self.client.get(f"{LIST}?section_id=0f3b4a1e-0000-4000-8000-000000000000")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"], [])

    def test_a_student_sees_only_their_own_rows(self) -> None:
        """§4 grants `student` an `own`-scoped view, which is why this viewset is
        the first in the codebase without `DenyRestrictedPrincipals`."""
        student_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.students[0].user_id = student_user.pk
            self.students[0].save(update_fields=["user_id", "updated_at"])
        authenticate(self.client, student_user)
        grant(
            student_user,
            "attendance.student-attendance.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )

        response = self.client.get(LIST)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["data"]), 1)
        self.assertEqual(response.data["data"][0]["student_id"], str(self.students[0].pk))

    def test_a_guardian_sees_only_the_children_they_are_linked_to(self) -> None:
        guardian_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            guardian = GuardianFactory(tenant=self.tenant, user_id=guardian_user.pk)
            StudentGuardianFactory(
                tenant=self.tenant,
                student=self.students[1],
                guardian=guardian,
                has_portal_access=True,
            )
        authenticate(self.client, guardian_user)
        grant(
            guardian_user,
            "attendance.student-attendance.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )

        response = self.client.get(LIST)

        self.assertEqual(len(response.data["data"]), 1)
        self.assertEqual(response.data["data"][0]["student_id"], str(self.students[1].pk))

    def test_a_class_teacher_sees_their_assigned_sections_rows(self) -> None:
        authenticate(self.client, self.teacher_user)
        grant(
            self.teacher_user,
            "attendance.student-attendance.view",
            scope=RecordScope.ASSIGNED,
        )

        response = self.client.get(LIST)

        self.assertEqual(len(response.data["data"]), 3)


class CorrectionEndpointTests(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow_everything()
        self.client.post(
            BULK_MARK,
            {
                "section_id": str(self.section.pk),
                "attendance_date": MARKING_DATE.isoformat(),
                "entries": [
                    {"student_id": str(s.pk), "status": AttendanceStatus.ABSENT}
                    for s in self.students
                ],
            },
            format="json",
        )
        with tenant_context(self.tenant.id):
            self.row = StudentAttendance.objects.alive().get(student=self.students[0])
            self.row.is_locked = True
            self.row.save(update_fields=["is_locked", "updated_at"])

        self.approver = UserFactory(tenant=self.tenant)
        grant(
            self.approver,
            "attendance.correction.create",
            "attendance.correction.approve",
            scope=RecordScope.ALL,
        )

    def request_body(self) -> dict:
        return {
            "student_attendance_id": str(self.row.pk),
            "new_values": {"status": AttendanceStatus.PRESENT},
            "reason": "The student was in the science lab.",
        }

    def test_a_correction_can_be_requested_against_a_locked_row(self) -> None:
        response = self.client.post(CORRECTIONS, self.request_body(), format="json")

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], CorrectionStatus.PENDING)
        self.assertEqual(
            response.data["data"]["old_values"]["status"], AttendanceStatus.ABSENT.value
        )

    def test_a_field_outside_the_correctable_set_is_refused(self) -> None:
        body = self.request_body()
        body["new_values"] = {"student_id": str(self.students[1].pk)}

        response = self.client.post(CORRECTIONS, body, format="json")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_approving_applies_the_change(self) -> None:
        created = self.client.post(CORRECTIONS, self.request_body(), format="json")
        correction_id = created.data["data"]["id"]

        authenticate(self.client, self.approver)
        response = self.client.post(f"{CORRECTIONS}/{correction_id}:approve", {}, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], CorrectionStatus.APPROVED)
        with tenant_context(self.tenant.id):
            self.row.refresh_from_db()
            self.assertEqual(self.row.status, AttendanceStatus.PRESENT)

    def test_rejecting_records_the_note_and_leaves_the_row(self) -> None:
        created = self.client.post(CORRECTIONS, self.request_body(), format="json")
        correction_id = created.data["data"]["id"]

        authenticate(self.client, self.approver)
        response = self.client.post(
            f"{CORRECTIONS}/{correction_id}:reject",
            {"review_note": "The register was right."},
            format="json",
        )

        self.assertEqual(response.data["data"]["status"], CorrectionStatus.REJECTED)
        self.assertEqual(response.data["data"]["review_note"], "The register was right.")
        with tenant_context(self.tenant.id):
            self.row.refresh_from_db()
            self.assertEqual(self.row.status, AttendanceStatus.ABSENT)

    def test_the_requester_cannot_approve_their_own_request(self) -> None:
        """§11 and RBAC §2.4. `self.user` holds the approve key, so the refusal
        can only come from the segregation-of-duties rule."""
        created = self.client.post(CORRECTIONS, self.request_body(), format="json")

        response = self.client.post(
            f"{CORRECTIONS}/{created.data['data']['id']}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_the_create_key_alone_cannot_approve(self) -> None:
        created = self.client.post(CORRECTIONS, self.request_body(), format="json")

        requester = UserFactory(tenant=self.tenant)
        authenticate(self.client, requester)
        grant(requester, "attendance.correction.create", scope=RecordScope.ALL)

        response = self.client.post(
            f"{CORRECTIONS}/{created.data['data']['id']}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_guardian_cannot_reach_the_correction_queue(self) -> None:
        """`DenyRestrictedPrincipals` is on this viewset — §4 grants
        `attendance.correction.*` to staff only."""
        guardian_user = UserFactory(tenant=self.tenant)
        authenticate(self.client, guardian_user)
        grant(
            guardian_user,
            "attendance.correction.create",
            scope=RecordScope.ALL,
            is_restricted_principal=True,
        )

        response = self.client.get(CORRECTIONS)

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
