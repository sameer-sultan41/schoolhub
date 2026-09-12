"""Shared surface for the timetable module.

Deliberately kept at the app root, unlike every other business rule in this
module (which now lives in one of the four resource packages — ``rooms/``,
``periods/``, ``slots/``, ``substitutions/`` — see
docs/03-modules/timetable.md §20):

- ``assert_staff_is_active_teacher`` is used by both ``slots/serializers.py``
  (a slot's own ``staff_id``) and ``substitutions/serializers.py`` (the
  substitute and absent staff on a proposal) — two sibling packages, no
  single owner.
- ``propose_substitutions_for_absence`` is a thin wrapper around the real
  implementation in ``substitutions/services.py``, where the whole
  substitution domain actually lives (see that module's own docstring for
  why the manual and automatic halves are not split). This is the one
  function ``apps.attendance.tasks`` imports cross-app as
  ``apps.timetable.services.propose_substitutions_for_absence`` — the
  wrapper preserves that import path without pulling the rest of the
  substitution logic up to the root. The import inside it is lazy
  (module-level would be circular: ``substitutions/services.py`` itself
  imports ``assert_staff_is_active_teacher`` from this module) — same
  lazy-import shape ``apps.school_organization.services`` uses for its own
  cross-app call into ``apps.staff_management.services``.
"""

from __future__ import annotations

import uuid
from datetime import date
from typing import TYPE_CHECKING

from apps.staff_management.models import EmploymentStatus, Staff, StaffType
from core.api.exceptions import DomainRuleViolation

if TYPE_CHECKING:
    from apps.timetable.models import TeacherSubstitution


def assert_staff_is_active_teacher(staff: Staff) -> None:
    if staff.employment_status != EmploymentStatus.ACTIVE:
        raise DomainRuleViolation({"staff_id": "This staff member is not active."})
    if staff.staff_type != StaffType.TEACHING:
        raise DomainRuleViolation({"staff_id": "Only teaching staff can be scheduled."})


def propose_substitutions_for_absence(
    *,
    staff: Staff,
    on_date: date,
    actor_id: uuid.UUID,
    leave_request_id: uuid.UUID | None = None,
) -> list[TeacherSubstitution]:
    from apps.timetable.substitutions.services import (
        propose_substitutions_for_absence as _propose_substitutions_for_absence,
    )

    return _propose_substitutions_for_absence(
        staff=staff, on_date=on_date, actor_id=actor_id, leave_request_id=leave_request_id
    )
