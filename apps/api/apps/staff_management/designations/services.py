"""Service rules exclusive to the Designation resource.

`assert_designation_active` (staff-creation validation) stays in the app-root
``services.py`` / moves into the ``staff/`` package — it is a Staff-side rule
despite the similar name, not a Designation one.
"""

from __future__ import annotations

from apps.staff_management.models import Designation, Staff
from core.api.exceptions import DomainRuleViolation


def assert_designation_deactivatable(*, designation: Designation) -> None:
    """Blocked deletion/deactivation while any staff record is assigned (§6)."""
    if Staff.objects.alive().filter(designation=designation).exists():
        raise DomainRuleViolation(
            {"is_active": "This designation is still assigned to staff and cannot be deactivated."}
        )
