"""`public_notices`: what the website may show of announcements and notices."""

from __future__ import annotations

import datetime

from django.test import TestCase
from django.utils import timezone

from apps.communication.models import AnnouncementStatus, NoticeStatus
from apps.communication.public import plain_text, public_notices
from apps.communication.tests.factories import AnnouncementFactory, NoticeFactory
from apps.school_organization.tests.factories import TenantFactory
from core.tenancy.context import tenant_context

NOW = timezone.now()


class PublicNoticesTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory()
        ctx = tenant_context(self.tenant.id)
        ctx.__enter__()
        self.addCleanup(ctx.__exit__, None, None, None)

    def announcement(self, **fields):
        defaults = {
            "tenant": self.tenant,
            "status": AnnouncementStatus.PUBLISHED,
            "show_on_website": True,
            "published_at": NOW,
        }
        return AnnouncementFactory(**{**defaults, **fields})

    def notice(self, **fields):
        defaults = {
            "tenant": self.tenant,
            "status": NoticeStatus.PUBLISHED,
            "show_on_website": True,
            "published_at": NOW,
        }
        return NoticeFactory(**{**defaults, **fields})

    def test_public_notices_excludes_expired_and_unflagged(self) -> None:
        shown_a = self.announcement(expires_at=NOW + datetime.timedelta(days=1))
        shown_n = self.notice(valid_until=timezone.localdate())
        self.announcement(show_on_website=False)
        self.announcement(status=AnnouncementStatus.DRAFT)
        self.announcement(expires_at=NOW - datetime.timedelta(minutes=1))
        self.notice(show_on_website=False)
        self.notice(status=NoticeStatus.PENDING_APPROVAL)
        self.notice(valid_until=timezone.localdate() - datetime.timedelta(days=1))
        self.assertEqual({row.id for row in public_notices(10)}, {shown_a.id, shown_n.id})

    def test_newest_first_across_both_kinds_and_limited(self) -> None:
        oldest = self.announcement(published_at=NOW - datetime.timedelta(days=3))
        middle = self.notice(published_at=NOW - datetime.timedelta(days=2))
        newest = self.announcement(published_at=NOW - datetime.timedelta(days=1))
        rows = public_notices(10)
        self.assertEqual([r.id for r in rows], [newest.id, middle.id, oldest.id])
        self.assertEqual([r.kind for r in rows], ["announcement", "notice", "announcement"])
        self.assertEqual([r.id for r in public_notices(2)], [newest.id, middle.id])

    def test_body_is_plain_text(self) -> None:
        self.announcement(
            body="<p>Hello <b>all</b></p><script>alert(1)</script><p>Fees &amp; dues</p>"
        )
        self.assertEqual(public_notices(1)[0].body, "Hello all\nFees & dues")

    def test_plain_text_edge_cases(self) -> None:
        self.assertEqual(plain_text(""), "")
        self.assertEqual(plain_text("a<br/>b<style>p{}</style>"), "a\nb")
        self.assertEqual(plain_text("**bold** text"), "**bold** text")

    def test_public_queries_are_constant(self) -> None:
        for _ in range(4):
            self.announcement()
            self.notice()
        with self.assertNumQueries(2):
            self.assertEqual(len(public_notices(20)), 8)
