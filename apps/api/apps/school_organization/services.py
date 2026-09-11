"""Shared surface for school-organization: cross-app and cross-package logic.

This file is not a leftover — it is a deliberate part of the layout. Unlike
communication's fully-split `services.py` (which had no consumers outside
that app), several functions here are imported directly by other apps:

- `assert_session_writable` — `apps/attendance/services.py`,
  `apps/academics/services.py`, `apps/student_management/services.py`,
  `apps/timetable/services.py`
- `map_subject_to_class` — `apps/academics/views.py`
- `assert_section_capacity` (and its helpers `section_seats_remaining`,
  `assert_capacity_not_below_occupancy`, kept alongside it rather than split
  across files for the same capacity concern) — `apps/student_management/
  services.py`

Moving them into a resource package would mean editing import lines in
other apps for a purely internal reorganization — a bigger, riskier blast
radius than this module's own size justifies. `_live_dependents` stays here
too, alongside `assert_deletable`, for a narrower reason: `apps/academics/
tests/test_api.py` patches it by name via
`mock.patch.object(school_services, "_live_dependents", ...)`, which pins it
to this exact module.

`is_valid_timezone` and `resolve_tenant_staff_id` stay here because they are
shared by several sibling packages inside this app (timezone validation by
`campuses/` and `school_settings/`; staff-id resolution by `campuses/`,
`departments/`, `sections/` and `houses/`) with no single package that owns
them.

This is this file's final shape: every ViewSet/APIView that used to live in
the flat `views.py` (`campuses`, `departments`, `academic_sessions`, `terms`,
`classes`, `sections`, `subjects`, `houses`, `school_settings`,
`holiday_calendar`) now has its own package, and `views.py` itself holds only
`BlockingDestroyMixin` — see that file's own docstring. The finished layout
and the reasoning behind it are documented in
`docs/03-modules/school-organization.md` §20, following the precedent
`communication.md` §20 sets for the same layout (adopted independently on
`apps/communication`, in parallel with this module).
"""

from __future__ import annotations

import functools
import uuid
import zoneinfo

from django.db.models import QuerySet

from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    ClassSubject,
    Section,
    SessionStatus,
    Subject,
)
from core.api.exceptions import Conflict, DomainRuleViolation

# Sessions in these states reject every write from transactional modules (§11).
# Shared with `academic_sessions/services/activate.py`, which checks the same
# states when activating a session — not private, since it is read from
# outside this module. `close.py` checks `status != ACTIVE` directly instead,
# since closing only ever applies to an active session.
LOCKED_SESSION_STATES = frozenset({SessionStatus.CLOSED, SessionStatus.ARCHIVED})


@functools.cache
def _iana_timezones() -> frozenset[str]:
    """Cached: available_timezones() walks the tzdata tree on every call."""
    return frozenset(zoneinfo.available_timezones())


def is_valid_timezone(name: str) -> bool:
    """True when ``name`` is an IANA identifier. No country is assumed (§11)."""
    return name in _iana_timezones()


def assert_session_writable(session: AcademicSession) -> None:
    """Guard for any write scoped to a session. Closed/archived sessions are read-only."""
    if session.status in LOCKED_SESSION_STATES:
        raise DomainRuleViolation(
            f"Academic session '{session.name}' is {session.status} and cannot be modified."
        )


def section_seats_remaining(section: Section, *, occupied: int) -> int | None:
    """Free seats, or None when the section is uncapped.

    ``occupied`` is passed in rather than counted here because student_enrollments
    is owned by the student-management module; this module must not reach into it.
    """
    if section.capacity is None:
        return None
    return section.capacity - occupied


def assert_section_capacity(section: Section, *, occupied: int, incoming: int = 1) -> None:
    """Reject an enrollment that would push a section past its capacity (§6, §11)."""
    remaining = section_seats_remaining(section, occupied=occupied)
    if remaining is not None and incoming > remaining:
        raise DomainRuleViolation(
            f"Section '{section.name}' has {max(remaining, 0)} seat(s) left; {incoming} requested."
        )


def assert_capacity_not_below_occupancy(section: Section, *, occupied: int) -> None:
    """A capacity cut may not strand students who are already enrolled."""
    if section.capacity is not None and section.capacity < occupied:
        raise DomainRuleViolation(
            f"Capacity {section.capacity} is below the {occupied} student(s) already enrolled."
        )


def map_subject_to_class(
    *,
    session: AcademicSession,
    school_class: Class,
    subject: Subject,
    campus: Campus | None = None,
    is_elective: bool = False,
    elective_group: str | None = None,
    weekly_periods: int = 1,
    syllabus_file_id: uuid.UUID | None = None,
    term_plans: list | None = None,
    notes: str | None = None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> ClassSubject:
    """Add a subject to a class's curriculum for one session (§5.6)."""
    assert_session_writable(session)

    if not school_class.is_active:
        raise DomainRuleViolation(f"Class '{school_class.name}' is inactive.")
    if not subject.is_active:
        raise DomainRuleViolation(f"Subject '{subject.name}' is inactive.")
    if weekly_periods < 1:
        raise DomainRuleViolation("weekly_periods must be at least 1.")
    if is_elective and not elective_group:
        raise DomainRuleViolation("elective_group is required for an elective mapping.")

    duplicate = ClassSubject.objects.alive().filter(
        academic_session=session, school_class=school_class, subject=subject, campus=campus
    )
    if duplicate.exists():
        raise Conflict(
            f"'{subject.name}' is already mapped to '{school_class.name}' for this session."
        )

    return ClassSubject.objects.create(
        tenant_id=tenant_id,
        academic_session=session,
        school_class=school_class,
        subject=subject,
        campus=campus,
        is_elective=is_elective,
        elective_group=elective_group,
        weekly_periods=weekly_periods,
        syllabus_file_id=syllabus_file_id,
        term_plans=term_plans,
        notes=notes,
        created_by=actor_id,
        updated_by=actor_id,
    )


def _live_dependents(instance) -> list[str]:
    """Names of relations that still hold non-deleted rows pointing at ``instance``."""
    blocking: list[str] = []
    for relation in instance._meta.related_objects:
        related_model = relation.related_model
        manager = getattr(related_model, "objects", None)
        if manager is None:
            continue
        rows: QuerySet = manager.filter(**{relation.field.name: instance})
        if "deleted_at" in {field.name for field in related_model._meta.fields}:
            rows = rows.filter(deleted_at__isnull=True)
        if rows.exists():
            # str(): verbose_name_plural is a lazy proxy, which str.join rejects.
            blocking.append(str(related_model._meta.verbose_name_plural))
    return blocking


def assert_deletable(instance) -> None:
    """Block deletion while dependents exist — deactivate instead (§6, §11).

    Checked in Python as well as by the PROTECT foreign keys so the caller gets a
    422 naming the blocking relations rather than a bare integrity error.
    """
    blocking = _live_dependents(instance)
    if blocking:
        raise DomainRuleViolation(
            "Cannot delete while dependent records exist ("
            + ", ".join(sorted(blocking))
            + "). Deactivate it instead."
        )


def resolve_tenant_staff_id(
    *, staff_id: uuid.UUID | None, tenant_id: uuid.UUID
) -> uuid.UUID | None:
    """Tenant-checked resolution of `head_staff_id`/`class_teacher_staff_id`/

    `house_master_staff_id` — those columns are plain UUIDs (not ForeignKeys),
    for the same cross-tenant-leak reason `staff.user_id` is (see
    staff_management/models.py's docstring): a naive `PrimaryKeyRelatedField`
    would happily resolve another tenant's staff id.

    Delegates to `staff_management.services.resolve_tenant_staff_id`, imported
    lazily: this points school-organization at staff-management, which inverts
    the direction docs/03-modules declares (staff-management depends on
    school-organization, not the reverse) — the lazy import keeps that
    inversion from becoming a hard import-time coupling between the two apps.
    Degrades to a plain validation error, never an import error, if
    staff-management is ever absent from INSTALLED_APPS.
    """
    if staff_id is None:
        return None
    try:
        from apps.staff_management.services import (
            resolve_tenant_staff_id as _resolve,
        )
    except ImportError as exc:  # pragma: no cover - defensive, see docstring
        raise DomainRuleViolation({"non_field": "Staff references are unavailable."}) from exc
    return _resolve(staff_id=staff_id, tenant_id=tenant_id)
