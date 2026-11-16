"""School events: slugs, rich-text description, date range, lifecycle (module doc §7 and §11).

Same file-visibility and revalidation contract as news; there is no delete, because §4 declares
no key for it (an event is archived instead).
"""

from __future__ import annotations

from datetime import datetime
from typing import Any
from uuid import UUID

from django.db import IntegrityError, transaction

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
from apps.website_cms.models import ContentStatus, SchoolEvent, SeoTargetType
from apps.website_cms.permissions import EVENT_PUBLISH_KEY
from apps.website_cms.revalidation import queue_revalidation
from apps.website_cms.validation import assert_files_usable, rich_text_file_ids, validate_rich_text
from core.files.visibility import sync_file_visibility
from core.tenancy.models import Tenant


def event_file_ids(event: SchoolEvent) -> set[UUID]:
    """Every file the event references: its cover, its description images and its social image."""
    ids = rich_text_file_ids(event.description) | seo_image_ids(
        SeoTargetType.SCHOOL_EVENT, event.id
    )
    if event.cover_image_file_id is not None:
        ids.add(event.cover_image_file_id)
    return ids


def _validate_content(data: dict[str, Any]) -> None:
    ids: set[UUID] = set()
    if "description" in data:
        validate_rich_text(data["description"])
        ids |= rich_text_file_ids(data["description"])
    if data.get("cover_image_file_id") is not None:
        ids.add(data["cover_image_file_id"])
    assert_files_usable(ids)


def _validate_range(starts_at: datetime, ends_at: datetime | None) -> None:
    if ends_at is not None and ends_at < starts_at:
        raise violation("ends_at", "end_before_start", "the event cannot end before it starts.")


def create_school_event(tenant: Tenant, data: dict[str, Any], actor_id: UUID | None) -> SchoolEvent:
    validate_content_slug(data["slug"])
    _validate_range(data["starts_at"], data.get("ends_at"))
    if slug_in_use(SchoolEvent, data["slug"]):
        raise slug_taken()
    _validate_content(data)
    try:
        with transaction.atomic():
            return SchoolEvent.objects.create(
                tenant=tenant, **data, created_by=actor_id, updated_by=actor_id
            )
    except IntegrityError as exc:
        raise slug_taken() from exc


def update_school_event(event: SchoolEvent, data: dict[str, Any], user: Any) -> SchoolEvent:
    if "slug" in data and data["slug"] != event.slug:
        validate_content_slug(data["slug"])
    _validate_content(data)
    try:
        with transaction.atomic():
            event = locked(SchoolEvent, event.pk)
            assert_may_edit(event.status, user, EVENT_PUBLISH_KEY)
            _validate_range(
                data.get("starts_at", event.starts_at), data.get("ends_at", event.ends_at)
            )
            renamed = "slug" in data and data["slug"] != event.slug
            if renamed and slug_in_use(SchoolEvent, data["slug"], exclude_id=event.id):
                raise slug_taken()
            old_ids = event_file_ids(event)
            for name, value in data.items():
                setattr(event, name, value)
            event.updated_by = user.pk
            event.save()
            if event.status == ContentStatus.PUBLISHED:
                sync_file_visibility(old_ids | event_file_ids(event))
                queue_revalidation(event.tenant_id)
    except IntegrityError as exc:
        raise slug_taken() from exc
    return event


def publish_school_event(event: SchoolEvent, user: Any) -> SchoolEvent:
    with transaction.atomic():
        event = locked(SchoolEvent, event.pk)
        if event.status == ContentStatus.PUBLISHED:
            return event
        touch(event, user.pk, status=ContentStatus.PUBLISHED)
        sync_file_visibility(event_file_ids(event))
        queue_revalidation(event.tenant_id)
    return event


def unpublish_school_event(event: SchoolEvent, user: Any) -> SchoolEvent:
    with transaction.atomic():
        event = locked(SchoolEvent, event.pk)
        if event.status != ContentStatus.PUBLISHED:
            return event
        touch(event, user.pk, status=ContentStatus.DRAFT)
        sync_file_visibility(event_file_ids(event))
        queue_revalidation(event.tenant_id)
    return event


def archive_school_event(event: SchoolEvent, user: Any) -> SchoolEvent:
    with transaction.atomic():
        event = locked(SchoolEvent, event.pk)
        if event.status == ContentStatus.ARCHIVED:
            return event
        was_published = event.status == ContentStatus.PUBLISHED
        touch(event, user.pk, status=ContentStatus.ARCHIVED)
        if was_published:
            sync_file_visibility(event_file_ids(event))
            queue_revalidation(event.tenant_id)
    return event
