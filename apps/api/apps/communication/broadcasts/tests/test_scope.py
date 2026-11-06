"""A campus-scoped sender broadcasts to their own campus only; `all` scope is unaffected.

`GET /broadcasts:scope` tells the screen the same thing before it sends.
"""

from __future__ import annotations

from rest_framework import status

from apps.communication.broadcasts.services.dispatch import BROADCAST_JOB_TYPE
from apps.communication.broadcasts.services.scope import CAMPUS_REQUIRED_MESSAGE
from apps.communication.broadcasts.tests.base import (
    MESSAGE,
    PREVIEW_URL,
    SCOPE_URL,
    SEND_URL,
    BroadcastAPITestCase,
)
from apps.communication.models import AudienceType
from apps.communication.tests.factories import CampusFactory, UserFactory, authenticate, grant
from core.jobs.models import BackgroundJob
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context


class CampusSenderTestCase(BroadcastAPITestCase):
    """A sender holding `broadcast.send` scoped to `self.campus` alone."""

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.other_campus = CampusFactory(tenant=self.tenant)
            self.sender = UserFactory(tenant=self.tenant)
            grant(
                self.sender,
                "communication.broadcast.send",
                scope=RecordScope.CAMPUS,
                scope_ref=self.campus.pk,
            )
        authenticate(self.client, self.sender)


class CampusScopedSenderTests(CampusSenderTestCase):
    def staff_audience(self, campus=None) -> dict:
        """Staff on ``campus``: the sender and the all-scope caller, at least."""
        body: dict = {"audience_type": AudienceType.STAFF, "message": MESSAGE}
        if campus is not None:
            body["campus_id"] = str(campus.pk)
        return body

    def jobs(self) -> list[BackgroundJob]:
        with tenant_context(self.tenant.id):
            return list(BackgroundJob.objects.filter(job_type=BROADCAST_JOB_TYPE))

    def test_own_campus_previews_and_sends(self) -> None:
        body = self.staff_audience(self.campus)

        preview = self.client.post(PREVIEW_URL, body, format="json")
        self.assertEqual(preview.status_code, status.HTTP_200_OK, preview.json())
        data = preview.json()["data"]
        send = self.client.post(
            SEND_URL,
            {
                **body,
                "confirm_recipient_count": data["recipient_count"],
                "audience_digest": data["audience_digest"],
            },
            format="json",
        )

        self.assertEqual(send.status_code, status.HTTP_202_ACCEPTED, send.json())
        self.assertEqual(len(self.jobs()), 1)

    def test_another_campus_is_404(self) -> None:
        body = self.staff_audience(self.other_campus)
        confirm = {"confirm_recipient_count": 1, "audience_digest": "0" * 64}

        preview = self.client.post(PREVIEW_URL, body, format="json")
        send = self.client.post(SEND_URL, {**body, **confirm}, format="json")

        self.assertEqual(preview.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(send.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.jobs(), [])

    def test_no_campus_id_is_422(self) -> None:
        body = self.staff_audience()
        confirm = {"confirm_recipient_count": 1, "audience_digest": "0" * 64}

        preview = self.client.post(PREVIEW_URL, body, format="json")
        send = self.client.post(SEND_URL, {**body, **confirm}, format="json")

        self.assertEqual(preview.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(preview.json()["error"]["message"], CAMPUS_REQUIRED_MESSAGE)
        self.assertEqual(send.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(self.jobs(), [])

    def test_a_sender_whose_scope_reaches_no_campus_is_404(self) -> None:
        """`own`/`assigned` only: there is no campus to choose, so not the "choose one" 422."""
        with tenant_context(self.tenant.id):
            assigned = UserFactory(tenant=self.tenant)
            grant(assigned, "communication.broadcast.send", scope=RecordScope.ASSIGNED)
        authenticate(self.client, assigned)
        confirm = {"confirm_recipient_count": 1, "audience_digest": "0" * 64}

        for body in (self.staff_audience(), self.staff_audience(self.campus)):
            with self.subTest(campus_id=body.get("campus_id")):
                preview = self.client.post(PREVIEW_URL, body, format="json")
                send = self.client.post(SEND_URL, {**body, **confirm}, format="json")

                self.assertEqual(preview.status_code, status.HTTP_404_NOT_FOUND)
                self.assertEqual(send.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.jobs(), [])

    def test_custom_audience_cannot_name_a_user_off_the_campus(self) -> None:
        # Alice holds no role and no student or guardian link: she is on no campus.
        body = {**self.audience(self.alice), "campus_id": str(self.campus.pk)}

        response = self.client.post(PREVIEW_URL, body, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_custom_audience_on_the_campus_is_allowed(self) -> None:
        body = {**self.audience(self.sender), "campus_id": str(self.campus.pk)}

        response = self.client.post(PREVIEW_URL, body, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["recipient_count"], 1)

    def test_all_scope_sender_is_unaffected(self) -> None:
        authenticate(self.client, self.user)

        no_campus = self.client.post(PREVIEW_URL, self.staff_audience(), format="json")
        other_campus = self.client.post(
            PREVIEW_URL, self.staff_audience(self.other_campus), format="json"
        )
        off_campus_user = self.client.post(PREVIEW_URL, self.audience(self.alice), format="json")

        self.assertEqual(no_campus.status_code, status.HTTP_200_OK, no_campus.json())
        self.assertEqual(other_campus.status_code, status.HTTP_200_OK, other_campus.json())
        self.assertEqual(off_campus_user.status_code, status.HTTP_200_OK, off_campus_user.json())

    def test_an_unrelated_all_scope_role_does_not_lift_the_campus_limit(self) -> None:
        """A scope belongs to its `user_role` (auth-and-rbac.md §2.3).

        Only the roles that grant `broadcast.send` decide where the sender may broadcast.
        """
        with tenant_context(self.tenant.id):
            grant(self.sender, "examinations.exam.view", scope=RecordScope.ALL)

        no_campus = self.client.post(PREVIEW_URL, self.staff_audience(), format="json")
        other_campus = self.client.post(
            PREVIEW_URL, self.staff_audience(self.other_campus), format="json"
        )
        own_campus = self.client.post(PREVIEW_URL, self.staff_audience(self.campus), format="json")

        self.assertEqual(no_campus.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(no_campus.json()["error"]["message"], CAMPUS_REQUIRED_MESSAGE)
        self.assertEqual(other_campus.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(own_campus.status_code, status.HTTP_200_OK, own_campus.json())

        confirm = {"confirm_recipient_count": 1, "audience_digest": "0" * 64}
        send_no_campus = self.client.post(
            SEND_URL, {**self.staff_audience(), **confirm}, format="json"
        )
        send_other_campus = self.client.post(
            SEND_URL, {**self.staff_audience(self.other_campus), **confirm}, format="json"
        )

        self.assertEqual(send_no_campus.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(send_other_campus.status_code, status.HTTP_404_NOT_FOUND)
        self.assertEqual(self.jobs(), [])

    def test_an_all_scope_role_that_grants_the_key_is_unrestricted(self) -> None:
        with tenant_context(self.tenant.id):
            grant(self.sender, "communication.broadcast.send", scope=RecordScope.ALL)

        no_campus = self.client.post(PREVIEW_URL, self.staff_audience(), format="json")
        other_campus = self.client.post(
            PREVIEW_URL, self.staff_audience(self.other_campus), format="json"
        )

        self.assertEqual(no_campus.status_code, status.HTTP_200_OK, no_campus.json())
        self.assertEqual(other_campus.status_code, status.HTTP_200_OK, other_campus.json())


class BroadcastScopeReadTests(CampusSenderTestCase):
    """`GET /broadcasts:scope` answers from `sender_campus_ids`, as the send enforces."""

    def scope(self):
        return self.client.get(SCOPE_URL)

    def test_an_all_scope_sender_is_unrestricted(self) -> None:
        authenticate(self.client, self.user)

        response = self.scope()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], {"campus_ids": None})

    def test_a_campus_scoped_sender_gets_their_campus(self) -> None:
        response = self.scope()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], {"campus_ids": [str(self.campus.pk)]})

    def test_campuses_from_two_granting_roles_are_listed_in_id_order(self) -> None:
        with tenant_context(self.tenant.id):
            grant(
                self.sender,
                "communication.broadcast.send",
                scope=RecordScope.CAMPUS,
                scope_ref=self.other_campus.pk,
            )

        response = self.scope()

        expected = sorted([str(self.campus.pk), str(self.other_campus.pk)])
        self.assertEqual(response.json()["data"], {"campus_ids": expected})

    def test_a_sender_whose_scope_reaches_no_campus_gets_an_empty_list(self) -> None:
        """A 200, not the send's 404: this reads the caller's own capability, not a record."""
        with tenant_context(self.tenant.id):
            assigned = UserFactory(tenant=self.tenant)
            grant(assigned, "communication.broadcast.send", scope=RecordScope.ASSIGNED)
        authenticate(self.client, assigned)

        response = self.scope()

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], {"campus_ids": []})

    def test_an_unrelated_all_scope_role_does_not_widen_the_list(self) -> None:
        with tenant_context(self.tenant.id):
            grant(self.sender, "examinations.exam.view", scope=RecordScope.ALL)

        response = self.scope()

        self.assertEqual(response.json()["data"], {"campus_ids": [str(self.campus.pk)]})

    def test_reading_the_scope_requires_broadcast_send(self) -> None:
        with tenant_context(self.tenant.id):
            publisher = UserFactory(tenant=self.tenant)
            grant(publisher, "communication.announcement.publish")
        authenticate(self.client, publisher)

        response = self.scope()

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_a_guardian_holding_the_key_is_refused(self) -> None:
        with tenant_context(self.tenant.id):
            guardian = UserFactory(tenant=self.tenant)
            # Even holding the key: a restricted principal never reaches a staff endpoint.
            grant(guardian, "communication.broadcast.send", is_restricted_principal=True)
        authenticate(self.client, guardian)

        response = self.scope()

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
