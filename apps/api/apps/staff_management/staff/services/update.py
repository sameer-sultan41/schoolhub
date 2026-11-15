"""Saving a staff edit, then re-deriving the visibility of any photo it may have changed."""

from __future__ import annotations

from django.db import transaction

from apps.staff_management.models import Staff
from apps.staff_management.visibility import sync_staff_photos


@transaction.atomic
def update_staff(*, serializer) -> Staff:
    """Save a validated staff serializer; a photo or website-flag change syncs file visibility."""
    before = serializer.instance
    old_photo_id, old_flag = before.photo_file_id, before.show_on_website
    staff = serializer.save()
    if staff.photo_file_id != old_photo_id or staff.show_on_website != old_flag:
        sync_staff_photos({old_photo_id, staff.photo_file_id})
    return staff
