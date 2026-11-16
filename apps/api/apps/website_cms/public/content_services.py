"""Content feeds behind the public API: news, events, galleries and the other modules' lists.

Every function runs with the tenant already bound by `PublicContentView.bound`, so RLS and the
tenant-scoped managers confine each query to the host's school. Only published, live rows are
read; each returns plain data in the shape its `Public*` serializer declares; nothing writes.
Image ids leave only as `media.public_file_url` redirect URLs, rich-text bodies included.
"""

from __future__ import annotations

from datetime import date
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from django.db.models import Count, F, Q, QuerySet
from django.db.models.functions import Coalesce, TruncDate
from django.utils import timezone

from apps.communication.public import public_notices
from apps.school_organization.public import public_classes, public_departments
from apps.staff_management.public import public_teachers
from apps.website_cms.constants import PUBLIC_ALBUM_ITEMS_MAX
from apps.website_cms.media import public_file_url, to_public
from apps.website_cms.models import (
    ContentStatus,
    GalleryAlbum,
    GalleryItem,
    MediaType,
    NewsPost,
    SchoolEvent,
)
from apps.website_cms.themes import load_rich_text_schema
from core.files.models import File, FileStatus, FileVisibility
from core.tenancy.models import Tenant


class EventScope:
    UPCOMING = "upcoming"
    PAST = "past"
    CHOICES = (UPCOMING, PAST)


def _cover(tenant_id: UUID, file_id: UUID | None) -> str | None:
    return public_file_url(tenant_id, file_id) if file_id else None


def _body(tenant_id: UUID, doc: Any) -> Any:
    """A rich-text document with each image block's `file_id` replaced by its public URL."""
    return to_public(load_rich_text_schema(), doc, tenant_id)


# --- news --------------------------------------------------------------------------------


def _published_news() -> QuerySet[NewsPost]:
    return NewsPost.objects.alive().filter(status=ContentStatus.PUBLISHED)


def _news_summary(post: NewsPost, tenant_id: UUID) -> dict[str, Any]:
    return {
        "id": post.id,
        "slug": post.slug,
        "title": post.title,
        "excerpt": post.excerpt,
        "cover_image_url": _cover(tenant_id, post.cover_image_file_id),
        "published_at": post.published_at,
    }


def read_news_list(tenant: Tenant, limit: int) -> list[dict[str, Any]]:
    """`PublicNewsPost[]`, newest first."""
    posts = _published_news().order_by(F("published_at").desc(nulls_last=True), "-created_at", "id")
    posts = posts[:limit]
    return [_news_summary(post, tenant.pk) for post in posts]


def read_news_post(tenant: Tenant, slug: str) -> dict[str, Any] | None:
    """`PublicNewsPostDetail` of a published post, or `None`."""
    post = _published_news().filter(slug=slug).first()
    if post is None:
        return None
    return {
        **_news_summary(post, tenant.pk),
        "body": _body(tenant.pk, post.body),
        "updated_at": post.updated_at,
    }


# --- events ------------------------------------------------------------------------------


def _published_events() -> QuerySet[SchoolEvent]:
    return SchoolEvent.objects.alive().filter(status=ContentStatus.PUBLISHED)


def _event_summary(event: SchoolEvent, tenant_id: UUID) -> dict[str, Any]:
    return {
        "id": event.id,
        "slug": event.slug,
        "title": event.title,
        "starts_at": event.starts_at,
        "ends_at": event.ends_at,
        "is_all_day": event.is_all_day,
        "location": event.location,
        "cover_image_url": _cover(tenant_id, event.cover_image_file_id),
    }


def read_event_list(tenant: Tenant, scope: str, limit: int) -> list[dict[str, Any]]:
    """`PublicSchoolEvent[]`. `upcoming` is not over yet, soonest first; `past` is the rest.

    A timed event is over at `coalesce(ends_at, starts_at)`. An all-day event stays up through
    the school's own calendar day of that instant, whatever the server's UTC clock says.
    """
    zone = ZoneInfo(tenant.timezone)
    events = _published_events().annotate(
        ends=Coalesce("ends_at", "starts_at"),
        end_day=TruncDate(Coalesce("ends_at", "starts_at"), tzinfo=zone),
    )
    now, today = timezone.now(), tenant.local_date()
    if scope == EventScope.PAST:
        over = Q(is_all_day=True, end_day__lt=today) | Q(is_all_day=False, ends__lt=now)
        events = events.filter(over).order_by("-starts_at", "id")
    else:
        live = Q(is_all_day=True, end_day__gte=today) | Q(is_all_day=False, ends__gte=now)
        events = events.filter(live).order_by("starts_at", "id")
    return [_event_summary(event, tenant.pk) for event in events[:limit]]


def read_event(tenant: Tenant, slug: str) -> dict[str, Any] | None:
    """`PublicSchoolEventDetail` of a published event, or `None`."""
    event = _published_events().filter(slug=slug).first()
    if event is None:
        return None
    return {
        **_event_summary(event, tenant.pk),
        "description": _body(tenant.pk, event.description),
        "updated_at": event.updated_at,
    }


# --- gallery -----------------------------------------------------------------------------


def _published_albums() -> QuerySet[GalleryAlbum]:
    return GalleryAlbum.objects.alive().filter(status=ContentStatus.PUBLISHED)


def _album_summary(album: GalleryAlbum, tenant_id: UUID) -> dict[str, Any]:
    return {
        "id": album.id,
        "slug": album.slug,
        "title": album.title,
        "description": album.description,
        "cover_image_url": _cover(tenant_id, album.cover_image_file_id),
        "published_at": album.published_at,
    }


def read_album_list(tenant: Tenant, limit: int) -> list[dict[str, Any]]:
    """`PublicGalleryAlbum[]`, newest first, with the count of each album's live items."""
    newest_first = (F("published_at").desc(nulls_last=True), "-created_at", "id")
    ordered = _published_albums().order_by(*newest_first)
    albums = list(ordered[:limit])
    counts = dict(
        GalleryItem.objects.alive()
        .filter(gallery_album__in=[album.id for album in albums])
        .values_list("gallery_album_id")
        .annotate(total=Count("id"))
        .order_by()
    )
    return [
        {**_album_summary(album, tenant.pk), "item_count": counts.get(album.id, 0)}
        for album in albums
    ]


def _item(item: GalleryItem, tenant_id: UUID) -> dict[str, Any]:
    return {
        "id": item.id,
        "media_type": item.media_type,
        "image_url": _cover(tenant_id, item.file_id),
        "embed_url": item.embed_url or None,
        "caption": item.caption,
        "alt_text": item.alt_text,
        "position": item.position,
    }


def read_album(tenant: Tenant, slug: str) -> dict[str, Any] | None:
    """`PublicGalleryAlbumDetail` of a published album with its items in order, or `None`."""
    album = _published_albums().filter(slug=slug).first()
    if album is None:
        return None
    live = GalleryItem.objects.alive().filter(gallery_album=album)
    items = live.order_by("position", "id")[:PUBLIC_ALBUM_ITEMS_MAX]
    return {
        **_album_summary(album, tenant.pk),
        "item_count": live.count(),
        "items": [_item(item, tenant.pk) for item in items],
    }


def read_gallery_images(tenant: Tenant, limit: int) -> list[dict[str, Any]]:
    """`PublicGalleryImage[]`: the latest images across published albums, newest first."""
    items = (
        GalleryItem.objects.alive()
        .filter(
            media_type=MediaType.IMAGE,
            file_id__isnull=False,
            gallery_album__status=ContentStatus.PUBLISHED,
            gallery_album__deleted_at__isnull=True,
        )
        .select_related("gallery_album")
        .order_by("-created_at", "id")[:limit]
    )
    return [
        {
            "id": item.id,
            "image_url": _cover(tenant.pk, item.file_id),
            "caption": item.caption,
            "alt_text": item.alt_text,
            "album_slug": item.gallery_album.slug,
            "album_title": item.gallery_album.title,
        }
        for item in items
    ]


# --- other modules' feeds ----------------------------------------------------------------


def _public_file_ids(file_ids: set[UUID]) -> set[UUID]:
    """The ids among `file_ids` that are ready, public files; the provider set the visibility."""
    if not file_ids:
        return set()
    return set(
        File.objects.alive()
        .filter(id__in=file_ids, status=FileStatus.READY, visibility=FileVisibility.PUBLIC)
        .values_list("id", flat=True)
    )


def read_teachers(tenant: Tenant, limit: int) -> list[dict[str, Any]]:
    """`PublicTeacher[]` from `staff_management.public`; a photo only when its file is public."""
    rows = public_teachers(limit)
    public = _public_file_ids({row.photo_file_id for row in rows if row.photo_file_id})
    return [
        {
            "id": row.id,
            "full_name": row.full_name,
            "designation": row.designation,
            "photo_url": (
                _cover(tenant.pk, row.photo_file_id) if row.photo_file_id in public else None
            ),
            "bio": row.bio,
        }
        for row in rows
    ]


def read_departments(limit: int) -> list[dict[str, Any]]:
    """`PublicDepartment[]` from `school_organization.public`."""
    return [
        {"id": row.id, "name": row.name, "description": row.description}
        for row in public_departments()[:limit]
    ]


def read_classes(limit: int) -> list[dict[str, Any]]:
    """`PublicClass[]` from `school_organization.public`."""
    return [
        {"id": row.id, "name": row.name, "level": row.level} for row in public_classes()[:limit]
    ]


def read_notices(tenant: Tenant, limit: int) -> list[dict[str, Any]]:
    """`PublicNotice[]` from `communication.public`, dated by the school's own calendar."""
    today: date = tenant.local_date()
    return [
        {
            "id": row.id,
            "kind": row.kind,
            "title": row.title,
            "body": row.body,
            "published_at": row.published_at,
        }
        for row in public_notices(limit, today)
    ]
