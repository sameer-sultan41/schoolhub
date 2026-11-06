"""`POST /broadcasts:emergency` — the confirmed send, its 409s, audit and idempotency."""

from __future__ import annotations

from rest_framework import status

from apps.communication.broadcasts.services.dispatch import AUDIT_BROADCAST, BROADCAST_JOB_TYPE
from apps.communication.broadcasts.tests.base import (
    MESSAGE,
    SEND_URL,
    BroadcastAPITestCase,
    expected_digest,
)
from apps.communication.notifications import EMERGENCY_BROADCAST
from apps.communication.tasks import send_emergency_broadcast_task
from core.audit.models import AuditLog
from core.jobs.models import BackgroundJob
from core.jobs.tests.base import assert_sent_on_commit, run_on_commit
from core.notifications.models import Notification
from core.tenancy.context import tenant_context


class BroadcastSendTests(BroadcastAPITestCase):
    def jobs(self):
        with tenant_context(self.tenant.id):
            return list(BackgroundJob.objects.filter(job_type=BROADCAST_JOB_TYPE))

    def test_send_is_202_with_job(self) -> None:
        response = self.send(self.confirmed(self.alice, self.bob))

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        [job] = self.jobs()
        self.assertEqual(response.json()["data"]["job_id"], str(job.pk))
        self.assertEqual(
            job.payload["recipient_ids"], sorted([str(self.alice.pk), str(self.bob.pk)])
        )
        self.assertEqual(job.payload["message"], MESSAGE)
        self.assertEqual(job.created_by, self.user.pk)

    def test_stale_count_is_409_and_creates_no_job(self) -> None:
        body = {**self.confirmed(self.alice, self.bob), "confirm_recipient_count": 3}

        response = self.send(body)

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        error = response.json()["error"]
        self.assertEqual(error["code"], "audience_changed")
        self.assertEqual(error["meta"]["recipient_count"], 2)
        self.assertEqual(error["meta"]["audience_digest"], expected_digest(self.alice, self.bob))
        self.assertEqual(self.jobs(), [])

    def test_same_count_different_audience_is_409(self) -> None:
        """One recipient out, another in: the count holds, the digest does not."""
        confirmed_for_alice = self.confirmed(self.alice)
        body = {
            **self.audience(self.bob),
            "confirm_recipient_count": confirmed_for_alice["confirm_recipient_count"],
            "audience_digest": confirmed_for_alice["audience_digest"],
        }

        response = self.send(body)

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)
        error = response.json()["error"]
        self.assertEqual(error["code"], "audience_changed")
        self.assertEqual(error["meta"]["recipient_count"], 1)
        self.assertEqual(error["meta"]["audience_digest"], expected_digest(self.bob))
        self.assertEqual(self.jobs(), [])

    def test_send_audits_message_and_channels(self) -> None:
        response = self.send(self.confirmed(self.alice, self.bob))

        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        with tenant_context(self.tenant.id):
            entry = AuditLog.objects.get(action=AUDIT_BROADCAST)
        self.assertEqual(str(entry.resource_id), response.json()["data"]["job_id"])
        self.assertEqual(entry.actor_id, self.user.pk)
        self.assertEqual(entry.after["message"], MESSAGE)
        self.assertEqual(entry.after["recipient_count"], 2)
        self.assertEqual(entry.after["channels"], ["email", "in_app"])
        self.assertEqual(entry.after["unavailable_channels"], ["push", "sms", "whatsapp"])
        self.assertEqual(entry.after["audience_type"], "custom")

    def test_same_idempotency_key_replays_same_job(self) -> None:
        body = self.confirmed(self.alice, self.bob)

        first = run_on_commit(self, lambda: self.send(body, HTTP_IDEMPOTENCY_KEY="click-1"))
        second = run_on_commit(self, lambda: self.send(body, HTTP_IDEMPOTENCY_KEY="click-1"))

        self.assertEqual(first.status_code, status.HTTP_202_ACCEPTED, first.json())
        self.assertEqual(second.status_code, status.HTTP_202_ACCEPTED, second.json())
        self.assertEqual(first.json()["data"]["job_id"], second.json()["data"]["job_id"])
        self.assertEqual(len(self.jobs()), 1)
        # One fan-out: one notification per recipient, not two.
        with tenant_context(self.tenant.id):
            self.assertEqual(Notification.objects.filter(event_key=EMERGENCY_BROADCAST).count(), 2)

    def test_same_key_with_a_corrected_message_is_422_not_a_replay(self) -> None:
        """The audience is unchanged, so only the body tells the corrected send apart."""
        body = self.confirmed(self.alice)
        corrected = {**body, "message": "Correction: school closes at one."}

        first = run_on_commit(self, lambda: self.send(body, HTTP_IDEMPOTENCY_KEY="click-3"))
        second = self.send(corrected, HTTP_IDEMPOTENCY_KEY="click-3")

        self.assertEqual(first.status_code, status.HTTP_202_ACCEPTED, first.json())
        self.assertEqual(second.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertEqual(second.json()["error"]["code"], "idempotency_key_reused")
        self.assertEqual(len(self.jobs()), 1)

    def test_a_409_is_not_replayed_for_the_same_key(self) -> None:
        """The 409 is raised, never stored, so a corrected retry with the key goes through."""
        body = self.confirmed(self.alice)
        stale = {**body, "confirm_recipient_count": 5}

        conflict = self.send(stale, HTTP_IDEMPOTENCY_KEY="click-2")
        retry = self.send(body, HTTP_IDEMPOTENCY_KEY="click-2")

        self.assertEqual(conflict.status_code, status.HTTP_409_CONFLICT)
        self.assertEqual(retry.status_code, status.HTTP_202_ACCEPTED, retry.json())
        self.assertEqual(len(self.jobs()), 1)

    def test_enqueue_is_sent_on_commit(self) -> None:
        body = self.confirmed(self.alice)

        assert_sent_on_commit(
            self,
            send_emergency_broadcast_task,
            lambda: self.client.post(SEND_URL, body, format="json"),
            tenant_id=self.tenant.pk,
            actor_id=self.user.pk,
        )
