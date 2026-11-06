"""`POST /leave-requests/{id}/attachment:download`: the request's scope decides who may read.

The purpose is module-gated, so this is the only route that signs a leave attachment
(ADR-0021, lesson L29): `/files` must not reach one, whatever file key the caller holds.
"""

from __future__ import annotations

from django.utils import timezone
from rest_framework import status

from apps.attendance import uploads
from apps.attendance.models import LeaveRequest, LeaveType, RequesterType
from apps.attendance.tests.factories import (
    CampusFactory,
    StudentFactory,
    TenantFactory,
    UserFactory,
    authenticate,
    enable_feature,
    grant,
)
from apps.attendance.tests.test_leave import next_monday
from apps.attendance.tests.test_leave_api import LEAVE_REQUESTS, LeaveAPITestCase
from apps.student_management.models import StudentGuardian
from core.files.models import FileStatus
from core.files.tests.factories import FileFactory
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


def download_path(leave_request: LeaveRequest) -> str:
    return f"{LEAVE_REQUESTS}/{leave_request.pk}/attachment:download"


class LeaveAttachmentDownloadTests(LeaveAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.note = self.make_file(self.guardian_user)
        self.own_request = self.make_request(self.students[0], attachment=self.note)

    def make_file(self, owner, **overrides):
        with tenant_context(self.tenant.id):
            return FileFactory(
                tenant=self.tenant,
                created_by=owner.pk,
                **{"purpose": uploads.LEAVE_ATTACHMENT.key, **overrides},
            )

    def make_request(self, student, *, attachment=None) -> LeaveRequest:
        with tenant_context(self.tenant.id):
            return LeaveRequest.objects.create(
                tenant=self.tenant,
                requester_type=RequesterType.STUDENT,
                student=student,
                leave_type=self.leave_type,
                start_date=next_monday(),
                end_date=next_monday(),
                days_count=1,
                reason="Fever.",
                attachment_file=attachment,
                submitted_by=self.guardian_user.pk,
            )

    def download(self, user, leave_request: LeaveRequest):
        authenticate(self.client, user)
        return self.client.post(download_path(leave_request), format="json")

    def test_guardian_downloads_attachment_for_own_child(self) -> None:
        response = self.download(self.guardian_user, self.own_request)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertTrue(response.json()["data"]["download_url"])

    def test_student_downloads_attachment_their_guardian_uploaded(self) -> None:
        student_user = UserFactory(tenant=self.tenant)
        with tenant_context(self.tenant.id):
            self.students[0].user_id = student_user.pk
            self.students[0].save(update_fields=["user_id", "updated_at"])
        grant(
            student_user,
            "attendance.leave-request.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )

        response = self.download(student_user, self.own_request)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_other_family_request_is_404(self) -> None:
        theirs = self.make_request(
            self.students[1], attachment=self.make_file(UserFactory(tenant=self.tenant))
        )

        response = self.download(self.guardian_user, theirs)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_request_without_attachment_is_404(self) -> None:
        bare = self.make_request(self.students[0])

        response = self.download(self.guardian_user, bare)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_unready_or_deleted_file_is_404(self) -> None:
        cases = {
            "pending": self.make_file(self.guardian_user, status=FileStatus.PENDING),
            "deleted": self.make_file(self.guardian_user, deleted_at=timezone.now()),
            "other purpose": self.make_file(self.guardian_user, purpose="student.document"),
        }
        for label, file in cases.items():
            with self.subTest(label):
                leave_request = self.make_request(self.students[0], attachment=file)

                response = self.download(self.guardian_user, leave_request)

                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_staff_approver_downloads_without_file_view_key(self) -> None:
        response = self.download(self.approver, self.own_request)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_guardian_whose_portal_access_was_revoked_gets_404(self) -> None:
        with tenant_context(self.tenant.id):
            StudentGuardian.objects.filter(guardian=self.guardian).update(has_portal_access=False)

        response = self.download(self.guardian_user, self.own_request)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_campus_scoped_staff_in_campus_downloads(self) -> None:
        reader = UserFactory(tenant=self.tenant)
        grant(
            reader,
            "attendance.leave-request.view",
            scope=RecordScope.CAMPUS,
            scope_ref=self.campus.pk,
        )

        response = self.download(reader, self.own_request)

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())

    def test_campus_scoped_staff_outside_campus_is_404(self) -> None:
        with tenant_context(self.tenant.id):
            elsewhere = CampusFactory(tenant=self.tenant)
        reader = UserFactory(tenant=self.tenant)
        grant(
            reader,
            "attendance.leave-request.view",
            scope=RecordScope.CAMPUS,
            scope_ref=elsewhere.pk,
        )

        response = self.download(reader, self.own_request)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_other_tenant_request_is_404(self) -> None:
        other = TenantFactory()
        enable_feature(other, "module.attendance")
        with tenant_context(other.id):
            student = StudentFactory(tenant=other, campus=CampusFactory(tenant=other))
            leave_type = LeaveType.objects.create(tenant=other, name="Theirs", code="THR")
            note = FileFactory(tenant=other, purpose=uploads.LEAVE_ATTACHMENT.key)
            foreign = LeaveRequest.objects.create(
                tenant=other,
                requester_type=RequesterType.STUDENT,
                student=student,
                leave_type=leave_type,
                start_date=next_monday(),
                end_date=next_monday(),
                days_count=1,
                reason="Not ours.",
                attachment_file=note,
                submitted_by=UserFactory(tenant=other).pk,
            )

        response = self.download(self.approver, foreign)

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_leave_attachment_is_module_gated(self) -> None:
        """A key to every file must still not reach a medical note through `/files`."""
        reader = UserFactory(tenant=self.tenant)
        grant(reader, "platform.file.view", scope=RecordScope.ALL)
        authenticate(self.client, reader)

        signed = self.client.post(f"/api/v1/files/{self.note.pk}:download", format="json")
        listed = self.client.get("/api/v1/files")

        self.assertEqual(signed.status_code, status.HTTP_404_NOT_FOUND)
        self.assertNotIn(str(self.note.pk), {row["id"] for row in listed.json()["data"]})
