"""Read-only staff data for the public website, called inside a bound tenant.

website_cms imports this module and nothing else of the app's internals (ADR-0013).
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from apps.staff_management.visibility import listed_staff


@dataclass(frozen=True)
class PublicTeacherRow:
    id: uuid.UUID
    full_name: str
    designation: str
    photo_file_id: uuid.UUID | None
    bio: str


def public_teachers(limit: int) -> list[PublicTeacherRow]:
    """Opted-in, employed staff, by name; one query."""
    rows = listed_staff().select_related("designation").order_by("last_name", "first_name", "id")
    return [
        PublicTeacherRow(
            id=staff.id,
            full_name=staff.full_name,
            designation=staff.designation.name if staff.designation else "",
            photo_file_id=staff.photo_file_id,
            bio=staff.public_bio or "",
        )
        for staff in rows[:limit]
    ]
