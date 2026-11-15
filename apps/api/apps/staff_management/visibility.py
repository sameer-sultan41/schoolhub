"""Which staff photos the public website keeps visible (ADR-0013's reference registry).

A photo is referenced while its staff row is opted in, employed and not deleted. Staff
services call `sync_staff_photos` after any change that can flip that; core never imports this app.
"""

from __future__ import annotations

from collections.abc import Iterable
from uuid import UUID

from django.db.models import QuerySet

from apps.staff_management.models import EmploymentStatus, Staff
from core.files.visibility import register_public_reference_provider, sync_file_visibility

# Suspended and exited staff drop off the website; leave is still employment.
LISTED_STATUSES = (EmploymentStatus.ACTIVE, EmploymentStatus.ON_LEAVE)


def listed_staff() -> QuerySet[Staff]:
    """Staff the school has opted onto the website, in the current tenant."""
    return Staff.objects.alive().filter(show_on_website=True, employment_status__in=LISTED_STATUSES)


def staff_photo_files(candidates: set[UUID]) -> set[UUID]:
    """The candidate files that a listed staff member uses as their photo."""
    if not candidates:
        return set()
    return set(
        listed_staff().filter(photo_file_id__in=candidates).values_list("photo_file_id", flat=True)
    )


def sync_staff_photos(file_ids: Iterable[UUID | None]) -> None:
    """Recompute visibility for the given photos (None entries are skipped)."""
    sync_file_visibility({file_id for file_id in file_ids if file_id is not None})


def register_providers() -> None:
    register_public_reference_provider(staff_photo_files)
