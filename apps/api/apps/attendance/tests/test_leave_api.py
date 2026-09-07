"""The leave endpoints — attendance.md §16.

Complements test_leave.py rather than repeating it: the chain rules are proved
against the service there, and these assert the HTTP contract — who may reach
which route, what the record scope returns through a real request, and the
cross-tenant 404s AGENTS.md invariant 4 requires on every endpoint.
"""

from __future__ import annotations

import datetime

from rest_framework import status

from apps.attendance.models import (
    LeaveAppliesTo,
    LeaveStatus,
    LeaveType,
    RequesterType,
    StudentAttendance,
)
from apps.attendance.tests.base import AttendanceAPITestCase
from apps.attendance.tests.factories import (
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    GuardianFactory,
    SectionFactory,
    StaffFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)
from apps.attendance.tests.test_leave import next_monday
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

LEAVE_REQUESTS = "/api/v1/leave-requests"
LEAVE_TYPES = "/api/v1/leave-types"


class LeaveAPITestCase(AttendanceAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.guardian_user = UserFactory(tenant=self.tenant)
        self.approver = UserFactory(tenant=self.tenant)

        with tenant_context(self.tenant.id):
            self.leave_type = LeaveType.objects.create(
                tenant=self.tenant,
                name="Sick Leave",
                code="SICK",
                applies_to=LeaveAppliesTo.BOTH,
            )
            self.guardian = GuardianFactory(tenant=self.tenant, user_id=self.guardian_user.pk)
            StudentGuardianFactory(
                tenant=self.tenant,
                student=self.students[0],
                guardian=self.guardian,
                has_portal_access=True,
            )

        grant(
            self.guardian_user,
            "attendance.leave-request.create",
            "attendance.leave-request.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )
        grant(
            self.approver,
            "attendance.leave-request.view",
            "attendance.leave-request.approve",
            scope=RecordScope.ALL,
        )

    def body(self, **overrides) -> dict:
        start = overrides.pop("start_date", next_monday())
        return {
            "student_id": str(self.students[0].pk),
            "leave_type_id": str(self.leave_type.pk),
            "start_date": start.isoformat(),
            "end_date": (start + datetime.timedelta(days=2)).isoformat(),
            "reason": "Chickenpox.",
            **overrides,
        }

    def submit_as_guardian(self):
        authenticate(self.client, self.guardian_user)
        return self.client.post(LEAVE_REQUESTS, self.body(), format="json")


class LeaveRequestEndpointTests(LeaveAPITestCase):
    def test_a_guardian_submits_for_their_own_child(self) -> None:
        response = self.submit_as_guardian()

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.data["data"]["status"], LeaveStatus.PENDING)
        self.assertEqual(response.data["data"]["requester_type"], RequesterType.STUDENT)
        # The chain is nested because §16 declares no `/approvals` sub-resource,
        # and "how many people must say yes" is a requester's first question.
        self.assertEqual(len(response.data["data"]["approvals"]), 1)

    def test_a_guardian_cannot_submit_for_someone_elses_child(self) -> None:
        """422, not 404: the student is in the caller's own tenant, so there is
        no cross-tenant existence to hide (AGENTS.md invariant 2 is about tenant
        boundaries). Naming the rule is more use to a portal than a bare 404."""
        authenticate(self.client, self.guardian_user)

        response = self.client.post(
            LEAVE_REQUESTS,
            self.body(student_id=str(self.students[1].pk)),
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_days_count_is_the_servers_answer_not_the_clients(self) -> None:
        authenticate(self.client, self.guardian_user)

        response = self.client.post(
            LEAVE_REQUESTS, {**self.body(), "days_count": "0.5"}, format="json"
        )

        self.assertEqual(response.data["data"]["days_count"], "3.0")

    def test_a_guardian_sees_only_the_children_they_are_linked_to(self) -> None:
        self.submit_as_guardian()

        other_guardian_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            other_guardian = GuardianFactory(tenant=self.tenant, user_id=other_guardian_user.pk)
            StudentGuardianFactory(
                tenant=self.tenant,
                student=self.students[1],
                guardian=other_guardian,
                has_portal_access=True,
            )
        authenticate(self.client, other_guardian_user)
        grant(
            other_guardian_user,
            "attendance.leave-request.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )

        response = self.client.get(LEAVE_REQUESTS)

        self.assertEqual(response.data["data"], [])

    def test_a_class_teacher_sees_their_assigned_sections_requests(self) -> None:
        """§4 grants `class_teacher` an `assigned`-scoped view, and §7.2 makes
        them the first approver — this is the queryset that queue is built from."""
        self.submit_as_guardian()
        authenticate(self.client, self.teacher_user)
        grant(self.teacher_user, "attendance.leave-request.view", scope=RecordScope.ASSIGNED)

        response = self.client.get(LEAVE_REQUESTS)

        self.assertEqual(len(response.data["data"]), 1)

    def test_approving_reports_how_many_days_were_auto_marked(self) -> None:
        """§7.2 can legitimately mark fewer days than the request covers, and an
        approver told only "approved" has no way to notice."""
        created = self.submit_as_guardian()
        authenticate(self.client, self.approver)

        response = self.client.post(
            f"{LEAVE_REQUESTS}/{created.data['data']['id']}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.data["data"]["status"], LeaveStatus.APPROVED)
        self.assertEqual(response.data["meta"]["auto_marked_days"], 3)
        with tenant_context(self.tenant.id):
            self.assertEqual(
                StudentAttendance.objects.alive().filter(student=self.students[0]).count(), 3
            )

    def test_rejecting_records_the_note(self) -> None:
        created = self.submit_as_guardian()
        authenticate(self.client, self.approver)

        response = self.client.post(
            f"{LEAVE_REQUESTS}/{created.data['data']['id']}:reject",
            {"note": "Please send a medical note."},
            format="json",
        )

        self.assertEqual(response.data["data"]["status"], LeaveStatus.REJECTED)
        self.assertEqual(
            response.data["data"]["approvals"][0]["note"], "Please send a medical note."
        )

    def test_the_submitter_can_cancel_their_own_request(self) -> None:
        """§6 puts cancellation with the requester, not the approver — which is
        why `:cancel` is keyed on `.create` rather than `.approve`."""
        created = self.submit_as_guardian()

        response = self.client.post(
            f"{LEAVE_REQUESTS}/{created.data['data']['id']}:cancel", {}, format="json"
        )

        self.assertEqual(response.data["data"]["status"], LeaveStatus.CANCELLED)

    def test_the_view_key_alone_cannot_approve(self) -> None:
        created = self.submit_as_guardian()
        reader = UserFactory(tenant=self.tenant)
        authenticate(self.client, reader)
        grant(reader, "attendance.leave-request.view", scope=RecordScope.ALL)

        response = self.client.post(
            f"{LEAVE_REQUESTS}/{created.data['data']['id']}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_request_cannot_be_edited_in_place(self) -> None:
        """§16 declares list, create and the three colon-actions. Editing a
        pending request would move dates an approver had already seen."""
        created = self.submit_as_guardian()

        response = self.client.patch(
            f"{LEAVE_REQUESTS}/{created.data['data']['id']}",
            {"reason": "Actually a holiday."},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_staff_leave_is_not_served_through_the_student_endpoints(self) -> None:
        """The table holds both kinds; only the student half is keyed here. An
        all-scoped attendance principal must not read staff leave before hr-leave
        has decided its visibility rules."""
        from apps.attendance.models import LeaveRequest

        with tenant_context(self.tenant.id):
            staff = StaffFactory(tenant=self.tenant, campus=self.campus)
            LeaveRequest.objects.create(
                tenant=self.tenant,
                requester_type=RequesterType.STAFF,
                staff=staff,
                leave_type=self.leave_type,
                start_date=next_monday(),
                end_date=next_monday(),
                days_count=1,
                reason="Personal.",
                submitted_by=self.user.pk,
            )

        authenticate(self.client, self.approver)
        response = self.client.get(LEAVE_REQUESTS)

        self.assertEqual(response.data["data"], [])


class LeaveTypeEndpointTests(LeaveAPITestCase):
    def test_a_requester_can_read_the_catalogue(self) -> None:
        """Reading the types takes `attendance.leave-request.view` — §4 keys no
        leave-type permission at all, and `.view` is the nearest key §4 grants to
        requesters *and* approvers alike. See views.py for the full reasoning."""
        authenticate(self.client, self.guardian_user)

        response = self.client.get(LEAVE_TYPES)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["data"]), 1)

    def test_leave_types_cannot_be_created_here(self) -> None:
        """Writing them is `hr.leave-type.*`, declared by hr-leave.md §4 —
        a namespace this module must not register on another's behalf."""
        authenticate(self.client, self.guardian_user)

        response = self.client.post(LEAVE_TYPES, {"name": "Invented", "code": "INV"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_405_METHOD_NOT_ALLOWED)

    def test_a_campus_scoped_caller_still_sees_the_catalogue(self) -> None:
        """`scope_campus_field = None`: a leave type is school-wide, the same
        shape as /classes and /subjects. Left at the default this raises
        FieldError for every campus-scoped caller — the bug PR #37 fixed across
        seven viewsets."""
        campus_admin = UserFactory(tenant=self.tenant)
        authenticate(self.client, campus_admin)
        grant(
            campus_admin,
            "attendance.leave-request.view",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )

        response = self.client.get(LEAVE_TYPES)

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.data["data"]), 1)

    def test_an_own_scoped_requester_sees_the_whole_catalogue(self) -> None:
        """Reference data has no owner. `scope_queryset` falls through to
        `.none()` for an `own`-scoped principal with no `filter_owned_by_user`,
        which is right for a record and wrong for a catalogue — the submission
        form had no types to choose from, and nothing errored."""
        authenticate(self.client, self.guardian_user)

        response = self.client.get(LEAVE_TYPES)

        self.assertEqual(len(response.data["data"]), 1)


class LeaveCrossTenantTests(LeaveAPITestCase):
    """AGENTS.md invariant 4: 404, never 403, on every endpoint."""

    def setUp(self) -> None:
        super().setUp()
        self.other = TenantFactory()
        self.other_user = UserFactory(tenant=self.other)
        enable_feature(self.other, "module.attendance")

        with tenant_context(self.other.id):
            other_campus = CampusFactory(tenant=self.other)
            other_session = AcademicSessionFactory(tenant=self.other, is_current=True)
            other_class = ClassFactory(tenant=self.other, level=6)
            other_section = SectionFactory(
                tenant=self.other, school_class=other_class, campus=other_campus
            )
            self.foreign_student = StudentFactory(tenant=self.other, campus=other_campus)
            StudentEnrollmentFactory(
                tenant=self.other,
                student=self.foreign_student,
                academic_session=other_session,
                school_class=other_class,
                section=other_section,
            )
            self.foreign_type = LeaveType.objects.create(
                tenant=self.other, name="Theirs", code="THR"
            )
            from apps.attendance.models import LeaveRequest

            self.foreign_request = LeaveRequest.objects.create(
                tenant=self.other,
                requester_type=RequesterType.STUDENT,
                student=self.foreign_student,
                leave_type=self.foreign_type,
                start_date=next_monday(),
                end_date=next_monday(),
                days_count=1,
                reason="Not ours.",
                submitted_by=self.other_user.pk,
            )
        authenticate(self.client, self.approver)

    def test_another_tenants_request_is_not_retrievable(self) -> None:
        response = self.client.get(f"{LEAVE_REQUESTS}/{self.foreign_request.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_another_tenants_requests_are_absent_from_the_list(self) -> None:
        response = self.client.get(LEAVE_REQUESTS)

        self.assertEqual(response.data["data"], [])

    def test_approving_another_tenants_request_is_a_404(self) -> None:
        response = self.client.post(
            f"{LEAVE_REQUESTS}/{self.foreign_request.pk}:approve", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_rejecting_another_tenants_request_is_a_404(self) -> None:
        response = self.client.post(
            f"{LEAVE_REQUESTS}/{self.foreign_request.pk}:reject", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_cancelling_another_tenants_request_is_a_404(self) -> None:
        authenticate(self.client, self.guardian_user)

        response = self.client.post(
            f"{LEAVE_REQUESTS}/{self.foreign_request.pk}:cancel", {}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_another_tenants_leave_type_is_not_readable(self) -> None:
        response = self.client.get(f"{LEAVE_TYPES}/{self.foreign_type.pk}")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_submitting_against_another_tenants_student_is_refused(self) -> None:
        authenticate(self.client, self.guardian_user)

        response = self.client.post(
            LEAVE_REQUESTS, self.body(student_id=str(self.foreign_student.pk)), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
