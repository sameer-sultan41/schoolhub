"""Account invitations: the emailed link, preview and accept (ADR-0033)."""

from __future__ import annotations

import hashlib
import json
import smtplib
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TenantFactory
from core.audit.models import AuditLog
from core.notifications import templates
from core.notifications.models import DeliveryLog, Notification, NotificationChannel
from core.notifications.templates import NotificationTemplate
from core.rbac.auth_emails import MAX_EMAIL_RETRIES
from core.rbac.invitations import eligibility
from core.rbac.invitations.services import create_invitation
from core.rbac.models import Invitation, InvitationStatus
from core.rbac.tests.link_helpers import (
    LINK_SETTINGS,
    emailed_link,
    invite,
    invited_user,
    without_app_eligibility_hooks,
)
from core.tenancy.context import tenant_context

PREVIEW_URL = "/api/v1/auth/invitations:preview"
ACCEPT_URL = "/api/v1/auth/invitations:accept"
RESET_URL = "/api/v1/auth/password-reset"
# `password_reset_ip` in THROTTLE_RATES (20/hour).
RESET_IP_LIMIT = 20
STRONG_PASSWORD = "test-password-accept-12345"


@override_settings(**LINK_SETTINGS)
class InvitationTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.tenant = TenantFactory()
        self.user = invited_user(self.tenant)
        without_app_eligibility_hooks(self)

    def accept(self, token: str, password: str = STRONG_PASSWORD, school: str | None = None):
        return self.client.post(
            ACCEPT_URL,
            {"school": school or self.tenant.slug, "token": token, "password": password},
            format="json",
        )

    def assert_invalid_link(self, response) -> None:
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
        self.assertEqual(response.data["error"]["code"], "invalid_link")

    def test_invitation_token_stored_hashed_and_link_emailed(self) -> None:
        invitation, token = invite(self, self.user)

        message = mail.outbox[-1]
        self.assertEqual(message.to, [self.user.email])
        link, fragment = emailed_link(message)
        self.assertTrue(
            link.startswith(f"https://{self.tenant.slug}.app.schoolhub.test/accept-invite#")
        )
        self.assertEqual(fragment["school"], self.tenant.slug)
        self.assertEqual(invitation.token_hash, hashlib.sha256(token.encode()).hexdigest())
        self.assertIsNotNone(invitation.sent_at)
        self.assertEqual(invitation.status, InvitationStatus.PENDING)
        with tenant_context(self.tenant.id):
            self.assertFalse(Invitation.objects.filter(token_hash=token).exists())
            # Security email bypasses notify(): nothing a delivery-log viewer can read.
            self.assertFalse(Notification.objects.exists())
            self.assertFalse(DeliveryLog.objects.exists())
        audit = json.dumps(list(AuditLog.objects.values_list("after", flat=True)))
        self.assertNotIn(token, audit)
        self.assertTrue(
            AuditLog.objects.filter(
                action="auth.invitation.sent", resource_id=invitation.id
            ).exists()
        )

    def test_preview_shows_who_and_where(self) -> None:
        _, token = invite(self, self.user)

        response = self.client.post(
            PREVIEW_URL, {"school": self.tenant.slug, "token": token}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.data)
        self.assertEqual(response.data["data"]["email"], self.user.email)
        self.assertEqual(response.data["data"]["school_name"], self.tenant.name)

    def test_accept_activates_and_sets_password(self) -> None:
        invitation, token = invite(self, self.user)

        response = self.accept(token)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT, response.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.is_active)
        self.assertTrue(self.user.check_password(STRONG_PASSWORD))
        with tenant_context(self.tenant.id):
            invitation.refresh_from_db()
        self.assertEqual(invitation.status, InvitationStatus.ACCEPTED)
        self.assertTrue(
            AuditLog.objects.filter(action="auth.invitation.accepted", tenant=self.tenant).exists()
        )

    def test_accept_twice_is_400_invalid_link(self) -> None:
        _, token = invite(self, self.user)
        self.assertEqual(self.accept(token).status_code, status.HTTP_204_NO_CONTENT)

        self.assert_invalid_link(self.accept(token, password="another-long-passphrase-77"))
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(STRONG_PASSWORD))

    def test_a_pending_link_on_an_active_account_is_400_invalid_link(self) -> None:
        """A link left pending on an account activated some other way must not set its password."""
        _, token = invite(self, self.user)
        self.user.set_password("test-password-already-active-31")
        self.user.is_active = True
        self.user.save(update_fields=["password", "is_active"])

        self.assert_invalid_link(self.accept(token, password="another-long-passphrase-88"))
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password("test-password-already-active-31"))

    def test_expired_invitation_is_400(self) -> None:
        invitation, token = invite(self, self.user)
        with tenant_context(self.tenant.id):
            Invitation.objects.filter(pk=invitation.pk).update(
                expires_at=timezone.now() - timedelta(minutes=1)
            )

        self.assert_invalid_link(self.accept(token))
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)

    def test_resend_revokes_previous_token(self) -> None:
        first, first_token = invite(self, self.user)
        _, second_token = invite(self, self.user)

        with tenant_context(self.tenant.id):
            first.refresh_from_db()
        self.assertEqual(first.status, InvitationStatus.REVOKED)
        self.assert_invalid_link(self.accept(first_token))
        self.assertEqual(self.accept(second_token).status_code, status.HTTP_204_NO_CONTENT)

    def test_accept_refused_when_person_no_longer_eligible(self) -> None:
        _, token = invite(self, self.user, kind="staff")

        with mock.patch.dict(eligibility._hooks, {"staff": lambda user: False}):
            self.assert_invalid_link(self.accept(token))
            preview = self.client.post(
                PREVIEW_URL, {"school": self.tenant.slug, "token": token}, format="json"
            )
            self.assert_invalid_link(preview)

        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
        self.assertFalse(self.user.has_usable_password())

    def test_weak_password_is_400_validation_error(self) -> None:
        _, token = invite(self, self.user)

        response = self.accept(token, password="12345")

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
        self.assertEqual(response.data["error"]["code"], "validation_error")
        self.assertIn("password", {d["field"] for d in response.data["error"]["details"]})
        self.user.refresh_from_db()
        self.assertFalse(self.user.is_active)
        # The invitation is not spent by a rejected password.
        self.assertEqual(self.accept(token).status_code, status.HTTP_204_NO_CONTENT)

    def test_unknown_school_is_400_invalid_link(self) -> None:
        _, token = invite(self, self.user)

        self.assert_invalid_link(self.accept(token, school="no-such-school"))
        self.assert_invalid_link(
            self.client.post(
                PREVIEW_URL, {"school": "no-such-school", "token": token}, format="json"
            )
        )

    def test_reset_burst_does_not_throttle_invitation_accept(self) -> None:
        # One address (a school's NAT) spends its whole reset bucket; accepting an
        # invitation from it still works, because invitations have their own bucket.
        _, token = invite(self, self.user)
        same_ip = {"REMOTE_ADDR": "203.0.113.7"}
        for index in range(RESET_IP_LIMIT):
            response = self.client.post(
                RESET_URL,
                {"school": self.tenant.slug, "email": f"person{index}@example.test"},
                **same_ip,
            )
            self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        throttled = self.client.post(
            RESET_URL, {"school": self.tenant.slug, "email": "one-more@example.test"}, **same_ip
        )
        self.assertEqual(throttled.status_code, status.HTTP_429_TOO_MANY_REQUESTS)

        response = self.client.post(
            ACCEPT_URL,
            {"school": self.tenant.slug, "token": token, "password": STRONG_PASSWORD},
            format="json",
            **same_ip,
        )

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT, response.data)

    def test_unknown_token_is_400_invalid_link(self) -> None:
        self.assert_invalid_link(self.accept("not-a-real-token"))

    def test_send_failure_marks_invitation_send_failed(self) -> None:
        adapter = mock.Mock()
        adapter.send.side_effect = smtplib.SMTPServerDisconnected("connection lost")

        with (
            mock.patch("core.rbac.auth_emails.get_adapter", return_value=adapter),
            self.captureOnCommitCallbacks(execute=True),
            tenant_context(self.tenant.id),
        ):
            invitation = create_invitation(user=self.user, kind="staff", actor_id=None)

        # The first attempt plus every retry Celery's autoretry allows.
        self.assertEqual(adapter.send.call_count, 1 + MAX_EMAIL_RETRIES)
        with tenant_context(self.tenant.id):
            invitation.refresh_from_db()
        self.assertEqual(invitation.status, InvitationStatus.SEND_FAILED)
        self.assertEqual(invitation.token_hash, "")
        self.assertTrue(
            AuditLog.objects.filter(
                action="auth.invitation.send_failed", resource_id=invitation.id
            ).exists()
        )

    def test_send_failure_audit_keeps_the_smtp_code_but_not_the_address(self) -> None:
        """`SMTPRecipientsRefused` carries the refused address; the audit row must not."""
        adapter = mock.Mock()
        adapter.send.side_effect = smtplib.SMTPRecipientsRefused(
            {self.user.email: (550, f"5.1.1 <{self.user.email}> unknown".encode())}
        )

        with (
            mock.patch("core.rbac.auth_emails.get_adapter", return_value=adapter),
            self.captureOnCommitCallbacks(execute=True),
            tenant_context(self.tenant.id),
        ):
            invitation = create_invitation(user=self.user, kind="staff", actor_id=None)

        event = AuditLog.objects.get(
            action="auth.invitation.send_failed", resource_id=invitation.id
        )
        self.assertEqual(event.after["error"], "SMTPRecipientsRefused 550")
        self.assertNotIn(self.user.email, json.dumps(event.after))

    def test_auth_email_ignores_tenant_template_override(self) -> None:
        previous = templates._override_resolver
        self.addCleanup(templates.set_override_resolver, previous)

        def hijack(code, channel, locale, tenant_id):
            return NotificationTemplate(
                code=code,
                channel=NotificationChannel.EMAIL,
                subject="Overridden",
                body="Send your link to someone else.",
            )

        templates.set_override_resolver(hijack)

        invite(self, self.user)

        message = mail.outbox[-1]
        self.assertNotIn("Overridden", message.subject)
        self.assertIn(self.tenant.name, message.subject)
        self.assertNotIn("someone else", message.body)
