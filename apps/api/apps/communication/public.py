"""Read-only notices for the public website, called inside a bound tenant.

website_cms imports this module and nothing else of the app's internals (ADR-0013).
"""

from __future__ import annotations

import html
import re
import uuid
from dataclasses import dataclass
from datetime import date, datetime

from django.db.models import Q
from django.utils import timezone
from django.utils.html import strip_tags

from apps.communication.models import Announcement, AnnouncementStatus, Notice, NoticeStatus

_DROPPED_BLOCKS = re.compile(r"<(script|style)\b[^>]*>.*?</\1\s*>", re.IGNORECASE | re.DOTALL)
_LINE_BREAKS = re.compile(r"<br\s*/?>|</(p|div|li|h[1-6])\s*>", re.IGNORECASE)
_BLANK_RUNS = re.compile(r"[ \t]*\n[ \t\n]*")
_SPACES = re.compile(r"[ \t]+")


@dataclass(frozen=True)
class PublicNoticeRow:
    id: uuid.UUID
    kind: str  # "announcement" | "notice"
    title: str
    body: str
    published_at: datetime


def plain_text(body: str) -> str:
    """The body with markup removed, for a renderer that escapes: no tags, no script/style text."""
    text = _LINE_BREAKS.sub("\n", _DROPPED_BLOCKS.sub("", body or ""))
    text = html.unescape(strip_tags(text))
    return _BLANK_RUNS.sub("\n", _SPACES.sub(" ", text)).strip()


def public_notices(limit: int, today: date) -> list[PublicNoticeRow]:
    """Published, opted-in, unexpired announcements and notices, newest first; two queries.

    `today` is the school's own date (`Tenant.local_date()`): a notice stays up through its
    `valid_until` day locally, whatever the server's UTC clock says.
    """
    now = timezone.now()
    announcements = (
        Announcement.objects.alive()
        .filter(status=AnnouncementStatus.PUBLISHED, show_on_website=True)
        .filter(Q(expires_at__isnull=True) | Q(expires_at__gt=now))
        .order_by("-published_at", "-created_at", "id")[:limit]
    )
    notices = (
        Notice.objects.alive()
        .filter(status=NoticeStatus.PUBLISHED, show_on_website=True)
        .filter(Q(valid_until__isnull=True) | Q(valid_until__gte=today))
        .order_by("-published_at", "-created_at", "id")[:limit]
    )
    rows = [
        PublicNoticeRow(
            id=item.id,
            kind=kind,
            title=item.title,
            body=plain_text(item.body),
            published_at=item.published_at or item.created_at,
        )
        for kind, items in (("announcement", announcements), ("notice", notices))
        for item in items
    ]
    rows.sort(key=lambda row: row.published_at, reverse=True)
    return rows[:limit]
