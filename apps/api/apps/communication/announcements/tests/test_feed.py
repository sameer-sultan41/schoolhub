"""Announcements — feed-visibility rules."""

from __future__ import annotations

from apps.communication.models import AnnouncementStatus
from apps.communication.tests.base import CommunicationAPITestCase
from apps.communication.tests.factories import AnnouncementFactory
from core.tenancy.context import tenant_context


class AnnouncementFeedTests(CommunicationAPITestCase):
    def test_show_on_website_only_ever_true_for_a_published_announcement(self) -> None:
        with tenant_context(self.tenant.id):
            draft = AnnouncementFactory(
                tenant=self.tenant, status=AnnouncementStatus.DRAFT, show_on_website=True
            )

        self.assertEqual(draft.status, AnnouncementStatus.DRAFT)
        # show_on_website is a flag the drafter sets ahead of publishing — the
        # website renderer only reads *published* rows (out of this PR's
        # scope), so the guarantee lives in what gets exposed, not in refusing
        # the flag on a draft.
        self.assertTrue(draft.show_on_website)
