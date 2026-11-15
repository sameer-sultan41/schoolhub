"""Public-reference registry: a file is public only while published content references it.

Apps register a provider; core never imports an app (ADR-0013). Each provider answers, for a
set of file ids, which of them its published content still references. `sync_file_visibility`
recomputes from that answer, so visibility is derived rather than flipped: unpublishing one of
two referencing rows leaves the file public, and removing the last reference makes it private.
"""

from __future__ import annotations

from collections.abc import Callable, Iterable
from uuid import UUID

from django.utils import timezone

from core.files.models import File, FileVisibility

PublicReferenceProvider = Callable[[set[UUID]], set[UUID]]

_providers: list[PublicReferenceProvider] = []


def register_public_reference_provider(fn: PublicReferenceProvider) -> None:
    """Add `fn`, which returns the subset of the given ids still referenced by published content.

    Idempotent, so an app's `ready()` can run more than once (test reloads).
    """
    if fn not in _providers:
        _providers.append(fn)


def sync_file_visibility(file_ids: Iterable[UUID]) -> None:
    """Make each file public iff any provider claims it, else private.

    Runs inside the caller's tenant context; ids outside it match no `File` row and are ignored.
    """
    ids = set(file_ids)
    if not ids:
        return
    claimed: set[UUID] = set()
    for provider in _providers:
        claimed |= provider(ids) & ids
    # Two set-based writes, each touching only rows whose visibility actually changes.
    now = timezone.now()
    files = File.objects.alive()
    files.filter(id__in=claimed).exclude(visibility=FileVisibility.PUBLIC).update(
        visibility=FileVisibility.PUBLIC, updated_at=now
    )
    files.filter(id__in=ids - claimed).exclude(visibility=FileVisibility.PRIVATE).update(
        visibility=FileVisibility.PRIVATE, updated_at=now
    )
