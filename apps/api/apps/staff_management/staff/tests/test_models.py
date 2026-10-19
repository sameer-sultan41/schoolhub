"""`Staff` model helpers that need no database."""

from __future__ import annotations

from django.test import SimpleTestCase

from apps.staff_management.models import Staff


class StaffFullNameTests(SimpleTestCase):
    def test_full_name_is_first_then_last(self) -> None:
        """The one display format every serializer shows (allocations, slots, cover)."""
        self.assertEqual(Staff(first_name="Amna", last_name="Raza").full_name, "Amna Raza")
