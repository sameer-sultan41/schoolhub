"""Business rules for `teacher_subject_allocations` — academics.md §6, §11.

Cut from the module root `apps.academics.services`; see that file's own
history for the shared layering rationale (views stay thin, the same rules
apply to the API, the bulk importer and the Celery jobs).
"""

from __future__ import annotations

import logging
import uuid
from datetime import date

from django.db import transaction
from django.db.models import DateField, F, Q, Value
from django.db.models.functions import Coalesce, Greatest
from django.utils import timezone

from apps.academics import notifications
from apps.academics.models import TeacherSubjectAllocation
from apps.academics.teacher_allocations.dates import assert_patch_dates_valid
from apps.school_organization.models import AcademicSession, ClassSubject, Section, Subject
from apps.school_organization.services import assert_session_writable
from apps.staff_management.models import EmploymentStatus, Staff, StaffType
from core.api.exceptions import Conflict, DomainRuleViolation

logger = logging.getLogger(__name__)

# §11: "load warnings at tenant-configured norm, hard cap optional". Advisory
# only — the doc calls these warnings, so they ride along in `meta` rather than
# rejecting the write.
DEFAULT_WEEKLY_PERIOD_NORM = 30


def assert_staff_is_active_teacher(staff: Staff) -> None:
    """§11: the allocated staff member must be active teaching staff."""
    if staff.employment_status != EmploymentStatus.ACTIVE:
        raise DomainRuleViolation(
            {"staff_id": "This staff member is not active and cannot be allocated."}
        )
    if staff.staff_type != StaffType.TEACHING:
        raise DomainRuleViolation({"staff_id": "Only teaching staff can be allocated a subject."})


def assert_subject_in_class_curriculum(
    *, session: AcademicSession, section: Section, subject: Subject
) -> None:
    """§11: allocating to a section requires the subject in that class's curriculum.

    Without this, a section could be taught a subject the class does not study —
    which timetable would then schedule and examinations would then grade.
    """
    in_curriculum = (
        ClassSubject.objects.alive()
        .filter(academic_session=session, school_class_id=section.school_class_id, subject=subject)
        .exists()
    )
    if not in_curriculum:
        raise DomainRuleViolation(
            {
                "subject_id": (
                    "This subject is not in the curriculum for this section's class in this "
                    "session. Add it to the curriculum first."
                )
            }
        )


def staff_display_name(staff: Staff) -> str:
    """A teacher's name as the allocation screens show it: first name, then last."""
    return f"{staff.first_name} {staff.last_name}"


def weekly_load_by_staff(*, session: AcademicSession) -> dict[uuid.UUID, int]:
    """Weekly period load per teacher for a session, in two queries flat.

    The obvious implementation — walk each allocation and look up its curriculum
    row — is an N+1, and the allocation grid renders every teacher at once, so it
    would be one query per cell. Instead both sides are fetched once and joined
    in Python: allocations with their section's class id, and the session's
    curriculum keyed by (class, subject).

    An allocation's own `weekly_periods` wins when set; that override column
    exists precisely so a teacher taking a subject at non-standard frequency does
    not distort the load maths.

    "Current" is a window, not just an open end: `effective_to IS NULL` on its
    own also matches an allocation that starts next term, so a teacher lined up
    for September counts against today's norm and the §11 warning fires on load
    nobody is carrying yet. A null `effective_from` means the allocation has
    been in force all along.
    """
    curriculum = {
        (row["school_class_id"], row["subject_id"]): row["weekly_periods"]
        for row in ClassSubject.objects.alive()
        .filter(academic_session=session)
        .values("school_class_id", "subject_id", "weekly_periods")
    }

    today = timezone.localdate()
    totals: dict[uuid.UUID, int] = {}
    allocations = (
        TeacherSubjectAllocation.objects.alive()
        .filter(
            Q(effective_from__isnull=True) | Q(effective_from__lte=today),
            academic_session=session,
            effective_to__isnull=True,
        )
        .values("staff_id", "subject_id", "weekly_periods", "section__school_class_id")
    )
    for allocation in allocations:
        periods = allocation["weekly_periods"]
        if periods is None:
            key = (allocation["section__school_class_id"], allocation["subject_id"])
            periods = curriculum.get(key, 0)
        totals[allocation["staff_id"]] = totals.get(allocation["staff_id"], 0) + periods
    return totals


def teacher_weekly_load(*, staff: Staff, session: AcademicSession) -> int:
    """One teacher's load. Prefer `weekly_load_by_staff` for more than one."""
    return weekly_load_by_staff(session=session).get(staff.pk, 0)


def load_warnings(*, staff: Staff, session: AcademicSession, norm: int | None = None) -> list[dict]:
    """Advisory over-load warnings for the allocation grid (§5.3, §11).

    Returned in the response `meta`, never raised: the module doc calls these
    warnings, and a school mid-way through building next year's grid needs to be
    able to save an over-loaded state and fix it afterwards.
    """
    ceiling = norm or DEFAULT_WEEKLY_PERIOD_NORM
    load = teacher_weekly_load(staff=staff, session=session)
    if load <= ceiling:
        return []
    return [
        {
            "code": "teacher_over_norm",
            "staff_id": str(staff.pk),
            "weekly_periods": load,
            "norm": ceiling,
        }
    ]


@transaction.atomic
def create_allocation(
    *,
    session: AcademicSession,
    section: Section,
    subject: Subject,
    staff: Staff,
    is_primary: bool = True,
    weekly_periods: int | None = None,
    effective_from: date | None = None,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
) -> TeacherSubjectAllocation:
    assert_session_writable(session)
    assert_staff_is_active_teacher(staff)
    assert_subject_in_class_curriculum(session=session, section=section, subject=subject)

    if is_primary:
        _end_date_current_primary(
            session=session, section=section, subject=subject, actor_id=actor_id
        )

    return TeacherSubjectAllocation.objects.create(
        tenant_id=tenant_id,
        academic_session=session,
        section=section,
        subject=subject,
        staff=staff,
        is_primary=is_primary,
        weekly_periods=weekly_periods,
        effective_from=effective_from,
        created_by=actor_id,
        updated_by=actor_id,
    )


@transaction.atomic
def update_allocation(
    *, allocation: TeacherSubjectAllocation, changes: dict, actor_id: uuid.UUID
) -> TeacherSubjectAllocation:
    """§11 for PATCH — the same rules `create_allocation` applies, on what changed.

    The generic mixin saved PATCHes straight through, so a closed session, a
    non-teaching staff member, or a subject outside the curriculum all slipped
    past, and promoting a co-teacher hit the one-primary constraint as a 409.

    Changing the teacher of a current primary is a reassignment (§6 history): the old row is
    end-dated and a new primary row is created, which is what comes back. Combined with an end
    date, a demotion or a move in the same PATCH it is refused. A co-teacher's or an ended row's
    teacher change edits the row in place.
    """
    assert_session_writable(allocation.academic_session)
    session = changes.get("academic_session", allocation.academic_session)
    section = changes.get("section", allocation.section)
    subject = changes.get("subject", allocation.subject)
    staff = changes.get("staff", allocation.staff)
    effective_to = changes.get("effective_to", allocation.effective_to)
    slot_changed = (session, section, subject) != (
        allocation.academic_session,
        allocation.section,
        allocation.subject,
    )
    is_primary = changes.get("is_primary", allocation.is_primary)
    teacher_changed = staff != allocation.staff
    current_primary = allocation.is_primary and allocation.effective_to is None
    ends_demotes_or_moves = not is_primary or effective_to is not None or slot_changed
    if current_primary and teacher_changed and ends_demotes_or_moves:
        raise DomainRuleViolation(
            {"staff_id": "Change the teacher on its own, then end, demote or move the allocation."}
        )
    # A Reinstate (effective_to -> null) or a promote-to-primary PATCH touches neither staff
    # nor the slot, yet brings back a row whose staff may have gone inactive or whose subject
    # may have left the curriculum, so create's checks run again. An edit that leaves an
    # already-active row active (weekly periods, say) must not fail on an unrelated change.
    reinstating = effective_to is None and allocation.effective_to is not None
    promoting = effective_to is None and is_primary and not allocation.is_primary
    becoming_active = reinstating or promoting
    if session != allocation.academic_session:
        assert_session_writable(session)
    if teacher_changed or becoming_active:
        assert_staff_is_active_teacher(staff)
    if slot_changed or becoming_active:
        assert_subject_in_class_curriculum(session=session, section=section, subject=subject)

    assert_patch_dates_valid(
        changes=changes,
        current_from=allocation.effective_from,
        current_to=allocation.effective_to,
    )

    if current_primary and teacher_changed:
        return _reassign_primary(
            allocation=allocation, staff=staff, changes=changes, actor_id=actor_id
        )

    becoming_current_primary = (
        is_primary
        and effective_to is None
        and (not allocation.is_primary or allocation.effective_to is not None or slot_changed)
    )
    if becoming_current_primary:
        _end_date_current_primary(
            session=session,
            section=section,
            subject=subject,
            actor_id=actor_id,
            exclude_pk=allocation.pk,
        )

    for field, value in changes.items():
        setattr(allocation, field, value)
    allocation.updated_by = actor_id
    # Only the changed columns, so a concurrent End or primary displacement isn't overwritten.
    allocation.save(update_fields=[*changes, "updated_by", "updated_at"])
    return allocation


def _reassign_primary(
    *, allocation: TeacherSubjectAllocation, staff: Staff, changes: dict, actor_id: uuid.UUID
) -> TeacherSubjectAllocation:
    """A new primary for the slot in place of `allocation`, which is end-dated and kept (§6).

    It is `create_allocation` for `staff`, so the same checks run for the new teacher and the
    old row is end-dated by the same rule. The new row starts when the old one ends (or later,
    if the PATCH says so), so the two never overlap; `weekly_periods` carries over unless the
    PATCH sets it.
    """
    existing = (
        TeacherSubjectAllocation.objects.alive()
        .filter(
            academic_session=allocation.academic_session,
            section=allocation.section,
            subject=allocation.subject,
            staff=staff,
        )
        .first()
    )
    if existing is not None:
        # `tsa_unique_allocation` ignores `effective_to`, so a new row for this teacher would 409
        # in the database; say what the user can do instead.
        if existing.effective_to is None:
            recourse = "Make that allocation the primary"
        elif existing.is_primary:
            recourse = "Reinstate that allocation"
        else:
            recourse = "Reinstate that allocation and make it the primary"
        raise Conflict(
            f"{staff_display_name(staff)} already has an allocation for this section and "
            f"subject. {recourse} instead of reassigning this one."
        )

    ends_on = _outgoing_end_date(allocation.effective_from)
    effective_from = changes.get("effective_from") or ends_on
    if effective_from < ends_on:
        raise DomainRuleViolation(
            {
                "effective_from": (
                    "The new teacher cannot start before the previous teacher's allocation "
                    f"ends on {ends_on.isoformat()}."
                )
            }
        )

    return create_allocation(
        session=allocation.academic_session,
        section=allocation.section,
        subject=allocation.subject,
        staff=staff,
        is_primary=True,
        weekly_periods=changes.get("weekly_periods", allocation.weekly_periods),
        effective_from=effective_from,
        tenant_id=allocation.tenant_id,
        actor_id=actor_id,
    )


def assert_allocation_deletable(allocation: TeacherSubjectAllocation) -> None:
    """§11: a closed or archived session's allocations are read-only history."""
    assert_session_writable(allocation.academic_session)


def _outgoing_end_date(effective_from: date | None) -> date:
    """The end date `_end_date_current_primary` gives a primary that starts on `effective_from`."""
    today = timezone.localdate()
    return max(effective_from or today, today)


def _end_date_current_primary(
    *,
    session: AcademicSession,
    section: Section,
    subject: Subject,
    actor_id: uuid.UUID,
    exclude_pk: uuid.UUID | None = None,
) -> None:
    """End-date the outgoing primary rather than deleting it (§6).

    "Reassignment mid-session preserves history (old allocation end-dated, not
    deleted)" — and it is also what keeps `tsa_one_primary_per_section_subject`
    satisfiable, since that constraint only counts allocations with no
    `effective_to`. Shared by create and PATCH; `exclude_pk` is the row being edited.
    """
    today = timezone.localdate()
    outgoing = TeacherSubjectAllocation.objects.alive().filter(
        academic_session=session,
        section=section,
        subject=subject,
        is_primary=True,
        effective_to__isnull=True,
    )
    if exclude_pk is not None:
        outgoing = outgoing.exclude(pk=exclude_pk)
    # A primary lined up to start later is ended at its own start: ending it
    # "today" would put effective_to before effective_from (tsa_effective_range_ordered).
    today_value = Value(today, output_field=DateField())
    outgoing.update(
        effective_to=Greatest(Coalesce(F("effective_from"), today_value), today_value),
        updated_by=actor_id,
        updated_at=timezone.now(),
    )


def notify_allocation_changed(
    *, allocation: TeacherSubjectAllocation, tenant_id: uuid.UUID
) -> None:
    """Never lets a notification failure undo the allocation — see
    staff_management/staff/services/invite.py's _notify_invited for the same reasoning."""
    from core.notifications.services import Recipient, notify

    if not allocation.staff.user_id:
        return
    try:
        with transaction.atomic():
            notify(
                notifications.ALLOCATION_CHANGED,
                tenant_id=tenant_id,
                recipients=[Recipient(user_id=allocation.staff.user_id)],
                context={
                    "teacher.first_name": allocation.staff.first_name,
                    "section.name": allocation.section.name,
                    "subject.name": allocation.subject.name,
                    "session.name": allocation.academic_session.name,
                },
                source_type="teacher_subject_allocation",
                source_id=allocation.pk,
            )
    except Exception:
        logger.exception("allocation-changed notification failed for %s", allocation.pk)
