"""Forgotten-password reset by emailed link (ADR-0033)."""

from __future__ import annotations

from django.core import mail
from django.core.cache import cache
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.school_organization.tests.factories import TenantFactory, UserFactory
from core.audit.models import AuditLog
from core.rbac.models import User
from core.rbac.tests.link_helpers import LINK_SETTINGS, emailed_link

RESET_URL = "/api/v1/auth/password-reset"
CONFIRM_URL = "/api/v1/auth/password-reset:confirm"
OLD_PASSWORD = "the-old-password-12345"
NEW_PASSWORD = "a-brand-new-passphrase-42"


@override_settings(**LINK_SETTINGS)
class PasswordResetTests(APITestCase):
    def setUp(self) -> None:
        super().setUp()
        cache.clear()
        self.tenant = TenantFactory()
        self.user = UserFactory(
            tenant=self.tenant, email="member@example.test", password=OLD_PASSWORD
        )

    def request_reset(self, email: str, school: str | None = None, **extra):
        """POST a reset request; return the response and how many tasks it queued."""
        with self.captureOnCommitCallbacks(execute=True) as callbacks:
            response = self.client.post(
                RESET_URL, {"school": school or self.tenant.slug, "email": email}, **extra
            )
        return response, len(callbacks)

    def reset_link(self) -> dict[str, str]:
        """Ask for a reset for ``self.user`` and return the emailed link's fragment."""
        response, _ = self.request_reset(self.user.email)
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        link, fragment = emailed_link(mail.outbox[-1])
        self.assertTrue(
            link.startswith(f"https://{self.tenant.slug}.app.schoolhub.test/reset-password#")
        )
        return fragment

    def confirm(self, fragment: dict[str, str], new_password: str = NEW_PASSWORD):
        return self.client.post(
            CONFIRM_URL,
            {
                "school": fragment["school"],
                "uid": fragment["uid"],
                "token": fragment["token"],
                "new_password": new_password,
            },
            format="json",
        )

    def assert_invalid_link(self, response) -> None:
        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST, response.data)
        self.assertEqual(response.data["error"]["code"], "invalid_link")

    def test_reset_emails_an_active_member(self) -> None:
        fragment = self.reset_link()

        self.assertEqual(mail.outbox[-1].to, [self.user.email])
        self.assertEqual(fragment["school"], self.tenant.slug)

    def test_reset_unknown_inactive_and_platform_email_all_204_no_email(self) -> None:
        UserFactory(tenant=self.tenant, email="gone@example.test", is_active=False)
        User.objects.create_user(
            email="platform@example.test", password=OLD_PASSWORD, is_platform=True
        )

        for email in ("nobody@example.test", "gone@example.test", "platform@example.test"):
            with self.subTest(email=email):
                response, queued = self.request_reset(email)
                self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
                # Same path as a real address: a task is queued, and it sends nothing.
                self.assertEqual(queued, 1)
        self.assertEqual(mail.outbox, [])

    def test_reset_unknown_school_is_204_no_task(self) -> None:
        response, queued = self.request_reset(self.user.email, school="no-such-school")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        self.assertEqual(queued, 0)
        self.assertEqual(mail.outbox, [])

    def test_reset_missing_email_is_400_validation_error(self) -> None:
        response = self.client.post(RESET_URL, {"school": self.tenant.slug})

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.data["error"]["code"], "validation_error")

    def test_reset_confirm_refuses_inactive_user(self) -> None:
        fragment = self.reset_link()
        User.objects.filter(pk=self.user.pk).update(is_active=False)

        self.assert_invalid_link(self.confirm(fragment))
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(OLD_PASSWORD))

    def test_reset_token_dies_after_use(self) -> None:
        fragment = self.reset_link()
        self.assertEqual(self.confirm(fragment).status_code, status.HTTP_204_NO_CONTENT)

        self.assert_invalid_link(self.confirm(fragment, new_password="yet-another-passphrase-9"))
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW_PASSWORD))

    def test_reset_confirm_at_another_school_is_400(self) -> None:
        fragment = self.reset_link()
        other = TenantFactory()

        self.assert_invalid_link(self.confirm({**fragment, "school": other.slug}))

    def test_reset_blacklists_refresh_tokens_and_sends_changed_email(self) -> None:
        session = RefreshToken.for_user(self.user)
        fragment = self.reset_link()

        with self.captureOnCommitCallbacks(execute=True):
            response = self.confirm(fragment)

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT, response.data)
        self.user.refresh_from_db()
        self.assertTrue(self.user.check_password(NEW_PASSWORD))
        self.assertTrue(BlacklistedToken.objects.filter(token__jti=session["jti"]).exists())
        changed = mail.outbox[-1]
        self.assertEqual(changed.to, [self.user.email])
        self.assertIn("password was changed", changed.subject)
        self.assertTrue(
            AuditLog.objects.filter(action="auth.password.reset", tenant=self.tenant).exists()
        )

    def test_reset_throttled_per_email(self) -> None:
        # Five from five addresses pass; the sixth for the same account is refused even
        # from a new IP, while another account from the same IP is still served.
        for index in range(5):
            response, _ = self.request_reset(self.user.email, REMOTE_ADDR=f"10.0.0.{index}")
            self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)

        response, queued = self.request_reset(self.user.email, REMOTE_ADDR="10.0.0.99")
        self.assertEqual(response.status_code, status.HTTP_429_TOO_MANY_REQUESTS)
        self.assertEqual(queued, 0)

        response, _ = self.request_reset("someone-else@example.test", REMOTE_ADDR="10.0.0.99")
        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
