"""Shared helpers for the invitation and password-reset tests."""

from __future__ import annotations

import re
from unittest import mock
from urllib.parse import parse_qs, urlsplit

from django.core import mail
from django.test import TestCase

from core.rbac.invitations import eligibility
from core.rbac.invitations.services import create_invitation
from core.rbac.models import Invitation, User
from core.tenancy.context import tenant_context

LINK = re.compile(r"https?://\S+")

# Every emailed link is built from these in the tests, whatever the CI environment sets.
LINK_SETTINGS = {
    "PLATFORM_DOMAIN": "schoolhub.test",
    "DASHBOARD_URL_SCHEME": "https",
    "DASHBOARD_URL_PORT": "",
}


def emailed_link(message: mail.EmailMessage) -> tuple[str, dict[str, str]]:
    """The one link in ``message``'s body, and its fragment parsed into a dict."""
    links = LINK.findall(message.body)
    assert len(links) == 1, f"expected one link, found {links}"
    fragment = parse_qs(urlsplit(links[0]).fragment)
    return links[0], {key: values[0] for key, values in fragment.items()}


def invite(test: TestCase, user: User, kind: str = "staff") -> tuple[Invitation, str]:
    """Create an invitation, run its send task, and return it with the emailed raw token."""
    sent_before = len(mail.outbox)
    with test.captureOnCommitCallbacks(execute=True), tenant_context(user.tenant_id):
        invitation = create_invitation(user=user, kind=kind, actor_id=None)
    test.assertEqual(len(mail.outbox), sent_before + 1)
    _, fragment = emailed_link(mail.outbox[-1])
    with tenant_context(user.tenant_id):
        invitation.refresh_from_db()
    return invitation, fragment["token"]


def invited_user(tenant, email: str = "invitee@example.test") -> User:
    """A user the way an invite leaves them: inactive, with no usable password."""
    user = User.objects.create_user(email=email, tenant=tenant, is_active=False)
    user.set_unusable_password()
    user.save(update_fields=["password"])
    return user


def without_app_eligibility_hooks(test: TestCase) -> None:
    """Clear the apps' eligibility hooks for one test, so it exercises core's mechanism alone.

    The staff hook needs a `Staff` row linked to the user; these tests invite bare users.
    Each app's own tests cover its hook.
    """
    patcher = mock.patch.dict(eligibility._hooks, clear=True)
    patcher.start()
    test.addCleanup(patcher.stop)
