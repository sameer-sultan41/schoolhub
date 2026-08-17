"""Business rules for the school-organization module.

Views stay thin: everything here is a rule from
schoolhub-srd/docs/03-modules/school-organization.md §7 (workflows) and §11
(validations). Keeping it out of serializers means the same rules apply to the
onboarding wizard, the bulk importer and Celery jobs, none of which go through a
serializer.

Concurrency note: the session lifecycle transitions take a row lock and run inside
an explicit transaction because "exactly one current session per tenant" is a
partial unique index — without the lock two simultaneous activations would race to
an IntegrityError instead of an orderly 409.
"""

from __future__ import annotations

import functools
import uuid
import zoneinfo
from datetime import date

from django.db import transaction
from django.db.models import QuerySet

from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    ClassSubject,
    Section,
    SessionStatus,
    Subject,
    Term,
)
from core.api.exceptions import Conflict, DomainRuleViolation

# Sessions in these states reject every write from transactional modules (§11).
_LOCKED_SESSION_STATES = frozenset({SessionStatus.CLOSED, SessionStatus.ARCHIVED})


@functools.cache
def _iana_timezones() -> frozenset[str]:
    """Cached: available_timezones() walks the tzdata tree on every call."""
    return frozenset(zoneinfo.available_timezones())


def is_valid_timezone(name: str) -> bool:
    """True when ``name`` is an IANA identifier. No country is assumed (§11)."""
    return name in _iana_timezones()


def assert_session_writable(session: AcademicSession) -> None:
    """Guard for any write scoped to a session. Closed/archived sessions are read-only."""
    if session.status in _LOCKED_SESSION_STATES:
        raise DomainRuleViolation(
            f"Academic session '{session.name}' is {session.status} and cannot be modified."
        )


def assert_no_session_overlap(
    *, start_date: date, end_date: date, exclude_id: uuid.UUID | None = None
) -> None:
    """Sessions may not overlap: two live school years would make enrollment ambiguous."""
    if end_date <= start_date:
        raise DomainRuleViolation("end_date must be after start_date.")

    clashes = AcademicSession.objects.alive().filter(
        start_date__lte=end_date, end_date__gte=start_date
    )
    if exclude_id is not None:
        clashes = clashes.exclude(pk=exclude_id)
    clash = clashes.first()
    if clash is not None:
        raise DomainRuleViolation(
            f"Dates overlap academic session '{clash.name}' "
            f"({clash.start_date} – {clash.end_date})."
        )


def assert_term_window(
    *,
    session: AcademicSession,
    start_date: date,
    end_date: date,
    exclude_id: uuid.UUID | None = None,
) -> None:
    """Terms must nest inside their session and not overlap their siblings (§11)."""
    if end_date <= start_date:
        raise DomainRuleViolation("end_date must be after start_date.")
    if start_date < session.start_date or end_date > session.end_date:
        raise DomainRuleViolation(
            f"Term dates must fall inside the session window "
            f"({session.start_date} – {session.end_date})."
        )

    siblings = Term.objects.alive().filter(
        academic_session=session, start_date__lte=end_date, end_date__gte=start_date
    )
    if exclude_id is not None:
        siblings = siblings.exclude(pk=exclude_id)
    sibling = siblings.first()
    if sibling is not None:
        raise DomainRuleViolation(f"Term dates overlap term '{sibling.name}'.")


def session_completeness_errors(session: AcademicSession) -> list[str]:
    """Everything that blocks activation, as one list — an operator fixes it in one pass.

    The checks are the activation gate from §7.1: somewhere to teach, something to
    teach, and a term calendar that actually covers the year.
    """
    errors: list[str] = []

    if not Campus.objects.alive().filter(is_active=True).exists():
        errors.append("At least one active campus is required.")

    sectioned_classes = (
        Class.objects.alive()
        .filter(is_active=True, sections__deleted_at__isnull=True, sections__is_active=True)
        .distinct()
    )
    if not sectioned_classes.exists():
        errors.append("At least one active class with an active section is required.")

    terms = list(session.terms.filter(deleted_at__isnull=True).order_by("start_date"))
    if not terms:
        errors.append("At least one term is required.")
    elif terms[0].start_date > session.start_date or terms[-1].end_date < session.end_date:
        errors.append("Term dates must cover the whole session window.")

    return errors


@transaction.atomic
def activate_session(session: AcademicSession, *, actor_id: uuid.UUID) -> AcademicSession:
    """Make ``session`` the tenant's current session after the §7.1 completeness check."""
    session = AcademicSession.objects.select_for_update().get(pk=session.pk)

    if session.status in _LOCKED_SESSION_STATES:
        raise Conflict(f"A {session.status} session cannot be activated.")
    if session.status == SessionStatus.ACTIVE and session.is_current:
        raise Conflict(f"Session '{session.name}' is already active.")

    errors = session_completeness_errors(session)
    if errors:
        raise DomainRuleViolation({"structure": errors})

    # Demote the incumbent first: the partial unique index allows only one current row.
    AcademicSession.objects.filter(is_current=True).exclude(pk=session.pk).update(
        is_current=False, updated_by=actor_id
    )

    session.status = SessionStatus.ACTIVE
    session.is_current = True
    session.updated_by = actor_id
    session.save(update_fields=["status", "is_current", "updated_by", "updated_at"])
    return session


@transaction.atomic
def close_session(session: AcademicSession, *, actor_id: uuid.UUID) -> AcademicSession:
    """Close an active session, locking it against further transactional writes (§7.2)."""
    session = AcademicSession.objects.select_for_update().get(pk=session.pk)

    if session.status != SessionStatus.ACTIVE:
        raise Conflict(f"Only an active session can be closed; this one is {session.status}.")

    session.status = SessionStatus.CLOSED
    session.is_current = False
    session.updated_by = actor_id
    session.save(update_fields=["status", "is_current", "updated_by", "updated_at"])
    return session


@transaction.atomic
def clone_session(
    source: AcademicSession,
    *,
    name: str,
    start_date: date,
    end_date: date,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> AcademicSession:
    """Create next year's session and copy the curriculum forward (§7.2).

    Classes, sections and subjects are structural and persist across years, so only
    the session-scoped curriculum rows need copying; terms are re-dated by hand
    because term boundaries rarely map one-to-one onto a new calendar.
    """
    assert_no_session_overlap(start_date=start_date, end_date=end_date)

    target = AcademicSession.objects.create(
        tenant_id=tenant_id,
        name=name,
        start_date=start_date,
        end_date=end_date,
        status=SessionStatus.PLANNED,
        is_current=False,
        created_by=actor_id,
        updated_by=actor_id,
    )

    cloned = [
        ClassSubject(
            tenant_id=tenant_id,
            academic_session=target,
            school_class_id=row.school_class_id,
            subject_id=row.subject_id,
            campus_id=row.campus_id,
            is_elective=row.is_elective,
            elective_group=row.elective_group,
            weekly_periods=row.weekly_periods,
            notes=row.notes,
            created_by=actor_id,
            updated_by=actor_id,
        )
        for row in ClassSubject.objects.alive().filter(academic_session=source)
    ]
    if cloned:
        ClassSubject.objects.bulk_create(cloned)

    return target


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
            f"Section '{section.name}' has {max(remaining, 0)} seat(s) left; "
            f"{incoming} requested."
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


def clear_primary_campus(*, keep_id: uuid.UUID | None, actor_id: uuid.UUID) -> None:
    """Demote the incumbent primary campus so a new one can take the flag.

    Promoting a new primary is the operator's stated intent, so we demote rather
    than reject. Must run *before* the promotion is written: the partial unique
    index is checked per statement, so writing two primaries and fixing it up
    afterwards would raise instead of succeeding.
    """
    demoted = Campus.objects.filter(is_primary=True)
    if keep_id is not None:
        demoted = demoted.exclude(pk=keep_id)
    demoted.update(is_primary=False, updated_by=actor_id)


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
