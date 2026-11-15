"""Gallery items: media rules, append, edit, delete and reorder (module doc §7 and §11).

Every writer locks the album row first, so item writes serialise with the album's publish
(its "at least one item" gate) and with each other's position writes.
"""

from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit
from uuid import UUID

from django.db import IntegrityError, transaction
from django.db.models import Max
from django.shortcuts import get_object_or_404
from django.utils import timezone

from apps.website_cms.constants import EMBED_HOSTS
from apps.website_cms.content import locked
from apps.website_cms.errors import violation
from apps.website_cms.models import ContentStatus, GalleryAlbum, GalleryItem, MediaType
from apps.website_cms.revalidation import queue_revalidation
from apps.website_cms.validation import assert_files_usable, is_safe_url
from core.files.visibility import sync_file_visibility
from core.tenancy.models import Tenant

#: Added to existing positions first, so `unique(gallery_album_id, position)` never collides.
POSITION_PARK_OFFSET = 10_000


def _validate_item(row: GalleryItem) -> None:
    """The media rules for the item as it will be stored (post-merge)."""
    if row.media_type == MediaType.IMAGE:
        if row.file_id is None:
            raise violation("file_id", "file_required", "an image item needs a file.")
        assert_files_usable([row.file_id])
        return
    if not row.embed_url:
        raise violation("embed_url", "embed_required", "a video item needs an embed URL.")
    if not is_safe_url(row.embed_url) or not row.embed_url.startswith("https://"):
        raise violation("embed_url", "invalid_url", "the embed URL must be an https URL.")
    if (urlsplit(row.embed_url).hostname or "").lower() not in EMBED_HOSTS:
        raise violation("embed_url", "embed_host_not_allowed", "this video host is not supported.")


def _normalise(row: GalleryItem) -> None:
    """Clear the field the media type does not use, so a type switch leaves no stale value."""
    if row.media_type == MediaType.IMAGE:
        row.embed_url = ""
    else:
        row.file_id = None


def _sync(album: GalleryAlbum, file_ids: set[UUID | None]) -> None:
    if album.status == ContentStatus.PUBLISHED:
        sync_file_visibility({i for i in file_ids if i is not None})
        queue_revalidation(album.tenant_id)


def create_gallery_item(
    tenant: Tenant, album: GalleryAlbum, data: dict[str, Any], actor_id: UUID | None
) -> GalleryItem:
    with transaction.atomic():
        album = locked(GalleryAlbum, album.pk)
        top = GalleryItem.objects.alive().filter(gallery_album=album).aggregate(top=Max("position"))
        item = GalleryItem(
            tenant=tenant,
            gallery_album=album,
            position=0 if top["top"] is None else top["top"] + 1,
            created_by=actor_id,
            updated_by=actor_id,
            **data,
        )
        _normalise(item)
        _validate_item(item)
        try:
            with transaction.atomic():
                item.save()
        except IntegrityError as exc:
            raise violation("position", "position_conflict", "retry the request.") from exc
        _sync(album, {item.file_id})
    return item


def _locked_item(album: GalleryAlbum, item_id: UUID) -> GalleryItem:
    return get_object_or_404(
        GalleryItem.objects.alive().select_for_update(), pk=item_id, gallery_album=album
    )


def update_gallery_item(
    album: GalleryAlbum, item: GalleryItem, data: dict[str, Any], actor_id: UUID | None
) -> GalleryItem:
    with transaction.atomic():
        album = locked(GalleryAlbum, album.pk)
        item = _locked_item(album, item.pk)
        old_file = item.file_id
        for name, value in data.items():
            setattr(item, name, value)
        _normalise(item)
        _validate_item(item)
        item.updated_by = actor_id
        item.save()
        _sync(album, {old_file, item.file_id})
    return item


def delete_gallery_item(album: GalleryAlbum, item: GalleryItem, actor_id: UUID | None) -> None:
    with transaction.atomic():
        album = locked(GalleryAlbum, album.pk)
        item = _locked_item(album, item.pk)
        item.deleted_at = timezone.now()
        item.updated_by = actor_id
        item.save(update_fields=["deleted_at", "updated_by", "updated_at"])
        _sync(album, {item.file_id})


def reorder_gallery_items(
    album: GalleryAlbum, ids: list[UUID], actor_id: UUID | None
) -> list[GalleryItem]:
    """Make the album's items exactly `ids`, in order; two passes avoid unique collisions."""
    with transaction.atomic():
        album = locked(GalleryAlbum, album.pk)
        live = {
            item.id: item
            for item in GalleryItem.objects.alive().select_for_update().filter(gallery_album=album)
        }
        if len(set(ids)) != len(ids) or set(ids) != live.keys():
            raise violation(
                "ids", "invalid_item_ids", "list every item of this album exactly once."
            )
        ordered = [live[i] for i in ids]
        for item in ordered:
            item.position += POSITION_PARK_OFFSET
        GalleryItem.objects.bulk_update(ordered, ["position"])
        now = timezone.now()
        for position, item in enumerate(ordered):
            item.position = position
            item.updated_by = actor_id
            item.updated_at = now
        GalleryItem.objects.bulk_update(ordered, ["position", "updated_by", "updated_at"])
        if album.status == ContentStatus.PUBLISHED:
            queue_revalidation(album.tenant_id)
    return ordered
