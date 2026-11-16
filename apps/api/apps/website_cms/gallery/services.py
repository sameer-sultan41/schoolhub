"""Gallery albums: slugs, event link, lifecycle (module doc §7 and §11).

An album is public while published; its cover, its items' files and its social image are
claimed by the visibility provider only then. Items are written in `item_services`, under the
same album row lock.
"""

from __future__ import annotations

from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.website_cms.content import (
    assert_may_edit,
    locked,
    seo_image_ids,
    slug_in_use,
    slug_taken,
    touch,
    validate_content_slug,
)
from apps.website_cms.errors import violation
from apps.website_cms.models import (
    ContentStatus,
    GalleryAlbum,
    GalleryItem,
    SchoolEvent,
    SeoTargetType,
)
from apps.website_cms.revalidation import queue_revalidation
from apps.website_cms.validation import assert_files_usable
from core.files.visibility import sync_file_visibility
from core.tenancy.models import Tenant

ALBUM_PUBLISH_KEY = "website.gallery-album.publish"


def album_file_ids(album: GalleryAlbum) -> set[UUID]:
    """Every file the album references: its cover, its image items and its social image."""
    ids = seo_image_ids(SeoTargetType.GALLERY_ALBUM, album.id)
    ids |= {
        file_id
        for file_id in GalleryItem.objects.alive()
        .filter(gallery_album=album, file_id__isnull=False)
        .values_list("file_id", flat=True)
        if file_id
    }
    if album.cover_image_file_id is not None:
        ids.add(album.cover_image_file_id)
    return ids


def _validate_content(data: dict[str, Any]) -> None:
    if data.get("cover_image_file_id") is not None:
        assert_files_usable([data["cover_image_file_id"]])
    event_id = data.get("school_event_id")
    if event_id is not None and not SchoolEvent.objects.alive().filter(id=event_id).exists():
        raise violation("school_event_id", "invalid_event", "this event does not exist.")


def create_gallery_album(
    tenant: Tenant, data: dict[str, Any], actor_id: UUID | None
) -> GalleryAlbum:
    validate_content_slug(data["slug"])
    if slug_in_use(GalleryAlbum, data["slug"]):
        raise slug_taken()
    _validate_content(data)
    try:
        with transaction.atomic():
            return GalleryAlbum.objects.create(
                tenant=tenant, **data, created_by=actor_id, updated_by=actor_id
            )
    except IntegrityError as exc:
        raise slug_taken() from exc


def update_gallery_album(album: GalleryAlbum, data: dict[str, Any], user: Any) -> GalleryAlbum:
    if "slug" in data and data["slug"] != album.slug:
        validate_content_slug(data["slug"])
    _validate_content(data)
    try:
        with transaction.atomic():
            album = locked(GalleryAlbum, album.pk)
            assert_may_edit(album.status, user, ALBUM_PUBLISH_KEY)
            renamed = "slug" in data and data["slug"] != album.slug
            if renamed and slug_in_use(GalleryAlbum, data["slug"], exclude_id=album.id):
                raise slug_taken()
            old_ids = album_file_ids(album)
            for name, value in data.items():
                setattr(album, name, value)
            album.updated_by = user.pk
            album.save()
            if album.status == ContentStatus.PUBLISHED:
                sync_file_visibility(old_ids | album_file_ids(album))
                queue_revalidation(album.tenant_id)
    except IntegrityError as exc:
        raise slug_taken() from exc
    return album


def publish_gallery_album(album: GalleryAlbum, user: Any) -> GalleryAlbum:
    with transaction.atomic():
        album = locked(GalleryAlbum, album.pk)
        if album.status == ContentStatus.PUBLISHED:
            return album
        if not GalleryItem.objects.alive().filter(gallery_album=album).exists():
            raise violation("items", "empty_album", "add at least one item before publishing.")
        touch(album, user.pk, status=ContentStatus.PUBLISHED, published_at=timezone.now())
        sync_file_visibility(album_file_ids(album))
        queue_revalidation(album.tenant_id)
    return album


def unpublish_gallery_album(album: GalleryAlbum, user: Any) -> GalleryAlbum:
    with transaction.atomic():
        album = locked(GalleryAlbum, album.pk)
        if album.status != ContentStatus.PUBLISHED:
            return album
        touch(album, user.pk, status=ContentStatus.DRAFT, published_at=None)
        sync_file_visibility(album_file_ids(album))
        queue_revalidation(album.tenant_id)
    return album


def delete_gallery_album(album: GalleryAlbum, user: Any) -> None:
    with transaction.atomic():
        album = locked(GalleryAlbum, album.pk)
        if album.status == ContentStatus.PUBLISHED:
            raise violation("status", "unpublish_first", "unpublish this album before deleting it.")
        file_ids = album_file_ids(album)
        now = timezone.now()
        GalleryItem.objects.alive().filter(gallery_album=album).update(
            deleted_at=now, updated_by=user.pk, updated_at=now
        )
        touch(album, user.pk, deleted_at=now)
        sync_file_visibility(file_ids)
