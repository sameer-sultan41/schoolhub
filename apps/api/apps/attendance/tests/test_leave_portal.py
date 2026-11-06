"""A guardian's leave request: attachment ownership and the child they may name."""

from __future__ import annotations

from rest_framework import status

from apps.attendance import uploads
from apps.attendance.tests.factories import UserFactory, authenticate
from apps.attendance.tests.test_leave_api import LEAVE_REQUESTS, LeaveAPITestCase
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context


def error_fields(response) -> set[str]:
    return {d["field"] for d in response.json()["error"]["details"]}


class LeavePortalAttachmentTests(LeaveAPITestCase):
    def make_file(self, owner):
        with tenant_context(self.tenant.id):
            return FileFactory(
                tenant=self.tenant, purpose=uploads.LEAVE_ATTACHMENT.key, created_by=owner.pk
            )

    def test_leave_with_own_file_is_created(self) -> None:
        mine = self.make_file(self.guardian_user)
        authenticate(self.client, self.guardian_user)

        response = self.client.post(
            LEAVE_REQUESTS, self.body(attachment_file_id=str(mine.pk)), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())

    def test_leave_with_someone_elses_file_is_422(self) -> None:
        theirs = self.make_file(UserFactory(tenant=self.tenant))
        authenticate(self.client, self.guardian_user)

        response = self.client.post(
            LEAVE_REQUESTS, self.body(attachment_file_id=str(theirs.pk)), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(error_fields(response), {"attachment_file_id"})

    def test_guardian_leave_for_unowned_student_is_422(self) -> None:
        """422 on `student_id`, the rule `test_a_guardian_cannot_submit_for_someone_elses_child`
        already pins: the student is in the caller's tenant, so there is nothing to hide."""
        authenticate(self.client, self.guardian_user)

        response = self.client.post(
            LEAVE_REQUESTS, self.body(student_id=str(self.students[1].pk)), format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(error_fields(response), {"student_id"})
