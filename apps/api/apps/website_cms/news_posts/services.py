"""News posts: slugs, rich-text body, lifecycle (module doc §7 and §11).

Every change that can alter which files published news references recomputes file visibility
from the union of the old and new references (plan decision 4), and every change a visitor can
see queues a renderer revalidation. Writers lock the row first and re-read its status.
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
from apps.website_cms.models import ContentStatus, NewsPost, SeoTargetType
from apps.website_cms.revalidation import queue_revalidation
from apps.website_cms.validation import assert_files_usable, rich_text_file_ids, validate_rich_text
from core.files.visibility import sync_file_visibility
from core.tenancy.models import Tenant


def news_file_ids(post: NewsPost) -> set[UUID]:
    """Every file the post references: its cover, its body images and its social image."""
    ids = rich_text_file_ids(post.body) | seo_image_ids(SeoTargetType.NEWS_POST, post.id)
    if post.cover_image_file_id is not None:
        ids.add(post.cover_image_file_id)
    return ids


def _validate_content(data: dict[str, Any]) -> None:
    """Rich-text body (canonicalised in place) and the files it and the cover reference."""
    ids: set[UUID] = set()
    if "body" in data:
        validate_rich_text(data["body"])
        ids |= rich_text_file_ids(data["body"])
    if data.get("cover_image_file_id") is not None:
        ids.add(data["cover_image_file_id"])
    assert_files_usable(ids)


def create_news_post(tenant: Tenant, data: dict[str, Any], actor_id: UUID | None) -> NewsPost:
    validate_content_slug(data["slug"])
    if slug_in_use(NewsPost, data["slug"]):
        raise slug_taken()
    _validate_content(data)
    try:
        with transaction.atomic():
            return NewsPost.objects.create(
                tenant=tenant, **data, created_by=actor_id, updated_by=actor_id
            )
    except IntegrityError as exc:
        raise slug_taken() from exc


def update_news_post(post: NewsPost, data: dict[str, Any], user: Any) -> NewsPost:
    if "slug" in data and data["slug"] != post.slug:
        validate_content_slug(data["slug"])
    _validate_content(data)
    try:
        with transaction.atomic():
            post = locked(NewsPost, post.pk)
            assert_may_edit(post.status, user, "website.news-post.publish")
            renamed = "slug" in data and data["slug"] != post.slug
            if renamed and slug_in_use(NewsPost, data["slug"], exclude_id=post.id):
                raise slug_taken()
            old_ids = news_file_ids(post)
            for name, value in data.items():
                setattr(post, name, value)
            post.updated_by = user.pk
            post.save()
            if post.status == ContentStatus.PUBLISHED:
                sync_file_visibility(old_ids | news_file_ids(post))
                queue_revalidation(post.tenant_id)
    except IntegrityError as exc:
        raise slug_taken() from exc
    return post


def publish_news_post(post: NewsPost, user: Any) -> NewsPost:
    with transaction.atomic():
        post = locked(NewsPost, post.pk)
        if post.status == ContentStatus.PUBLISHED:
            return post
        touch(post, user.pk, status=ContentStatus.PUBLISHED, published_at=timezone.now())
        sync_file_visibility(news_file_ids(post))
        queue_revalidation(post.tenant_id)
    return post


def unpublish_news_post(post: NewsPost, user: Any) -> NewsPost:
    with transaction.atomic():
        post = locked(NewsPost, post.pk)
        if post.status != ContentStatus.PUBLISHED:
            return post
        touch(post, user.pk, status=ContentStatus.DRAFT, published_at=None)
        sync_file_visibility(news_file_ids(post))
        queue_revalidation(post.tenant_id)
    return post


def archive_news_post(post: NewsPost, user: Any) -> NewsPost:
    with transaction.atomic():
        post = locked(NewsPost, post.pk)
        if post.status == ContentStatus.ARCHIVED:
            return post
        was_published = post.status == ContentStatus.PUBLISHED
        touch(post, user.pk, status=ContentStatus.ARCHIVED, published_at=None)
        if was_published:
            sync_file_visibility(news_file_ids(post))
            queue_revalidation(post.tenant_id)
    return post


def delete_news_post(post: NewsPost, user: Any) -> None:
    with transaction.atomic():
        post = locked(NewsPost, post.pk)
        if post.status == ContentStatus.PUBLISHED:
            raise violation("status", "unpublish_first", "unpublish this post before deleting it.")
        file_ids = news_file_ids(post)
        touch(post, user.pk, deleted_at=timezone.now())
        sync_file_visibility(file_ids)
