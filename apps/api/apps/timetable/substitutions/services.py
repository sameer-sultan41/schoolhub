"""Business rules for teacher substitutions — timetable.md §7.2, §11, §18.

Manual create/approve/reject and the automatic proposal engine that attendance
drives share one file rather than splitting into "manual" and "automatic"
halves: the automatic path (`propose_substitutions_for_absence`,
`slots_needing_cover`, `_first_free_substitute`) calls `create_substitution`
for each slot it covers, and `create_substitution` shares its validation
(`assert_substitution_valid`, `_assert_substitute_is_free`) with a
hand-submitted proposal. Splitting them would fragment one cohesive concern
across two files that call back and forth into each other.

`propose_substitutions_for_absence` is imported cross-app by
`apps.attendance.tasks` via `apps.timetable.services`, which re-exports it from
here — see that module's own import for the real dependency.
"""

from __future__ import annotations

import logging
import uuid
from datetime import date

from django.db import transaction
from django.utils import timezone

from apps.staff_management.models import EmploymentStatus, Staff, StaffType
from apps.timetable import notifications
from apps.timetable.models import (
    OPEN_SUBSTITUTION_STATUSES,
    Room,
    SlotStatus,
    SubstitutionStatus,
    TeacherSubstitution,
    TimetableSlot,
)
from apps.timetable.services import assert_staff_is_active_teacher
from core.api.exceptions import Conflict, DomainRuleViolation

logger = logging.getLogger(__name__)


def assert_substitution_valid(
    *, slot: TimetableSlot, on_date: date, absent_staff: Staff, substitute_staff: Staff
) -> None:
    """§11's three substitution rules, in the order that fails cheapest first."""
    if substitute_staff.pk == absent_staff.pk:
        raise DomainRuleViolation(
            {"substitute_staff_id": "The substitute must be a different teacher."}
        )
    assert_staff_is_active_teacher(substitute_staff)

    if slot.staff_id != absent_staff.pk:
        raise DomainRuleViolation(
            {"absent_staff_id": "This teacher is not the one scheduled for that slot."}
        )

    if on_date.weekday() != _slot_weekday(slot):
        raise DomainRuleViolation({"date": "This date does not fall on the slot's weekday."})

    session = slot.academic_session
    if not (session.start_date <= on_date <= session.end_date):
        raise DomainRuleViolation({"date": "This date is outside the academic session."})

    _assert_substitute_is_free(
        slot=slot, on_date=on_date, absent_staff=absent_staff, substitute_staff=substitute_staff
    )


def _slot_weekday(slot: TimetableSlot) -> int:
    """`day_of_week` is 0-6 with the week's start set per tenant, while
    `date.weekday()` is always Monday-based. They coincide only while the tenant
    starts its week on Monday, which every seeded tenant does today — a real
    conversion belongs with the tenant week-start setting that does not exist yet."""
    return slot.day_of_week


def _teaching_in_cell(slot: TimetableSlot):
    """The live published cells at `slot`'s weekday and period in its session: a teacher
    holding one is teaching then."""
    return TimetableSlot.objects.alive().filter(
        academic_session=slot.academic_session,
        day_of_week=slot.day_of_week,
        period=slot.period,
        status=SlotStatus.PUBLISHED,
        effective_to__isnull=True,
    )


def _covering_in_cell(slot: TimetableSlot, on_date: date):
    """Open cover in `slot`'s period on `on_date`: its substitute is busy then."""
    return TeacherSubstitution.objects.alive().filter(
        date=on_date, period=slot.period, status__in=OPEN_SUBSTITUTION_STATUSES
    )


def _staff_away_on(on_date: date) -> set[uuid.UUID]:
    """Attendance's own reading of who is on leave or marked away. Imported here, not at
    the top: attendance imports this module's `propose_substitutions_for_absence`."""
    from apps.attendance.services import staff_away_on

    return staff_away_on(on_date=on_date)


def free_substitutes(
    *, slot: TimetableSlot, on_date: date, absent_staff: Staff, away: set[uuid.UUID] | None = None
):
    """Every teacher who could cover `slot` on `on_date`, in one query plus attendance's two.

    Active teaching staff **at the slot's own campus** (cover across sites is a teacher
    assigned to a room they can't reach), not the absent teacher, not teaching or covering
    in that period, and not away that day. The same rules `_assert_substitute_is_free`
    checks one teacher against, so the lookup, a hand-made proposal and the automatic one
    can't disagree about who is free.
    """
    return (
        Staff.objects.alive()
        .filter(
            employment_status=EmploymentStatus.ACTIVE,
            staff_type=StaffType.TEACHING,
            campus_id=slot.section.campus_id,
        )
        .exclude(pk=absent_staff.pk)
        .exclude(pk__in=_teaching_in_cell(slot).filter(staff__isnull=False).values("staff_id"))
        .exclude(pk__in=_covering_in_cell(slot, on_date).values("substitute_staff_id"))
        .exclude(pk__in=_staff_away_on(on_date) if away is None else away)
    )


def _assert_substitute_is_free(
    *, slot: TimetableSlot, on_date: date, absent_staff: Staff, substitute_staff: Staff
) -> None:
    """The substitute must be free at that (date, period) — §11 — and in school that day.

    `free_substitutes` decides, so the lookup, a hand-made proposal and the automatic one
    can't disagree. Its own predicates then name the reason for a refusal. The covering
    half is also `subs_substitute_one_per_period`, which holds when two proposals race.
    """
    free = free_substitutes(slot=slot, on_date=on_date, absent_staff=absent_staff)
    if free.filter(pk=substitute_staff.pk).exists():
        return
    if substitute_staff.campus_id != slot.section.campus_id:
        reason = "This teacher works at another campus."
    elif _teaching_in_cell(slot).filter(staff=substitute_staff).exists():
        reason = "This teacher already has a class in that period."
    elif _covering_in_cell(slot, on_date).filter(substitute_staff=substitute_staff).exists():
        reason = "This teacher is already covering another class in that period."
    elif substitute_staff.pk in _staff_away_on(on_date):
        reason = "This teacher is on leave or marked absent that day."
    else:
        reason = "This teacher can't cover that period."
    raise DomainRuleViolation({"substitute_staff_id": reason})


def _assert_room_is_free(*, slot: TimetableSlot, on_date: date, room: Room) -> None:
    """A room moved onto for one date must be free at that (date, period).

    §6's ad-hoc room change is a real booking, so it earns the same treatment the
    base grid gives `room_double_booked`: a hard clash, checked before the row is
    written. Two ways to be taken — a published slot occupies the room in that
    cell, or another substitution has already moved onto it that date.

    A substitution that stays in the slot's own room is not a move, so the slot
    it belongs to never counts against itself.

    As with the substitute check, the substitution-versus-substitution half is
    backed by `subs_room_one_per_period` for the racing case; the published-slot
    half crosses tables and lives only here.
    """
    occupied = (
        TimetableSlot.objects.alive()
        .filter(
            academic_session=slot.academic_session,
            room=room,
            day_of_week=slot.day_of_week,
            period=slot.period,
            status=SlotStatus.PUBLISHED,
            effective_to__isnull=True,
        )
        .exclude(pk=slot.pk)
        .exists()
    )
    if occupied:
        raise DomainRuleViolation({"room_id": "This room is already in use in that period."})

    already_moved = (
        TeacherSubstitution.objects.alive()
        .filter(
            room=room,
            date=on_date,
            period=slot.period,
            status__in=OPEN_SUBSTITUTION_STATUSES,
        )
        .exclude(timetable_slot=slot)
        .exists()
    )
    if already_moved:
        raise DomainRuleViolation(
            {"room_id": "Another substitution has already moved into this room in that period."}
        )


@transaction.atomic
def create_substitution(
    *,
    slot: TimetableSlot,
    on_date: date,
    absent_staff: Staff,
    substitute_staff: Staff,
    reason: str | None,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    room: Room | None = None,
    leave_request_id: uuid.UUID | None = None,
) -> TeacherSubstitution:
    """`leave_request_id` is set only by the absent-teacher feed, never by a
    client: §7.2 has the signal arriving *from* attendance, so a hand-created
    substitution naming one would assert a link nothing checked."""
    if slot.status != SlotStatus.PUBLISHED:
        raise DomainRuleViolation(
            {"timetable_slot_id": "Only a published slot can be substituted."}
        )
    assert_substitution_valid(
        slot=slot, on_date=on_date, absent_staff=absent_staff, substitute_staff=substitute_staff
    )
    if room is not None and room.pk != slot.room_id:
        _assert_room_is_free(slot=slot, on_date=on_date, room=room)

    substitution = TeacherSubstitution.objects.create(
        tenant_id=tenant_id,
        timetable_slot=slot,
        period_id=slot.period_id,
        date=on_date,
        absent_staff=absent_staff,
        substitute_staff=substitute_staff,
        room=room,
        reason=reason,
        leave_request_id=leave_request_id,
        status=SubstitutionStatus.PROPOSED,
        created_by=actor_id,
        updated_by=actor_id,
    )
    _notify_substitute(substitution=substitution, tenant_id=tenant_id)
    return substitution


def _notify_substitute(*, substitution: TeacherSubstitution, tenant_id: uuid.UUID) -> None:
    from core.notifications.services import Recipient, notify

    user_id = substitution.substitute_staff.user_id
    if not user_id:
        return
    try:
        with transaction.atomic():
            notify(
                notifications.SUBSTITUTION_ASSIGNED,
                tenant_id=tenant_id,
                recipients=[Recipient(user_id=user_id)],
                context={
                    "substitute.first_name": substitution.substitute_staff.first_name,
                    "section.name": substitution.timetable_slot.section.name,
                    "date": substitution.date.isoformat(),
                    "period.name": substitution.timetable_slot.period.name,
                },
                source_type="teacher_substitution",
                source_id=substitution.pk,
            )
    except Exception:
        logger.exception("substitution-assigned notification failed for %s", substitution.pk)


@transaction.atomic
def decide_substitution(
    *, substitution: TeacherSubstitution, approve: bool, actor_id: uuid.UUID
) -> TeacherSubstitution:
    """§7.2's approval step. Only a proposal is decidable.

    Re-read under `select_for_update` rather than trusting the row the view
    already fetched: two `:approve`/`:reject` calls arriving together would both
    read `proposed`, both clear the guard, and race to overwrite each other's
    decision — the loser's approver would be told their decision stuck when it
    did not. The lock makes the second call wait and then see the real status.

    The expected status is restated in the UPDATE's own WHERE as well. The lock
    is what serialises, but the conditional write is what *decides*: it is the
    one statement whose row count can prove no one else got there first, and it
    keeps this correct if a later caller reaches the service without holding the
    lock. Same shape as `academics.services.assert_batch_in_status` guarding its
    batch UPDATE.
    """
    locked = TeacherSubstitution.objects.alive().select_for_update().get(pk=substitution.pk)
    if locked.status != SubstitutionStatus.PROPOSED:
        raise Conflict(f"This substitution is {locked.status} and cannot be decided again.")

    decision = SubstitutionStatus.CONFIRMED if approve else SubstitutionStatus.DECLINED
    decided = (
        TeacherSubstitution.objects.alive()
        .filter(pk=locked.pk, status=SubstitutionStatus.PROPOSED)
        .update(status=decision, updated_by=actor_id, updated_at=timezone.now())
    )
    if not decided:
        raise Conflict("This substitution was decided by someone else while you were deciding.")

    substitution.refresh_from_db()
    _notify_decision(substitution=substitution)
    return substitution


@transaction.atomic
def cancel_substitution(
    *, substitution: TeacherSubstitution, actor_id: uuid.UUID, own_proposal_only: bool
) -> TeacherSubstitution:
    """Releases cover that is no longer wanted: `proposed` or `confirmed` → `cancelled`.

    `own_proposal_only` is the proposer withdrawing their own proposal; an approver may
    cancel any open cover. Who may do which is the view's to decide (it reads the keys);
    this enforces what the row allows. Today or later only: past cover is history.

    The same locked re-read and conditional UPDATE as `decide_substitution`, so a cancel
    racing an approval can't both succeed. The slot and the substitute are free again
    once this commits (the open-only constraints stop counting the row).
    """
    locked = TeacherSubstitution.objects.alive().select_for_update().get(pk=substitution.pk)
    allowed = (SubstitutionStatus.PROPOSED,) if own_proposal_only else OPEN_SUBSTITUTION_STATUSES
    if locked.status not in allowed:
        raise Conflict(f"This substitution is {locked.status} and cannot be cancelled.")
    if locked.date < timezone.localdate():
        raise DomainRuleViolation({"date": "Past cover cannot be cancelled."})

    cancelled = (
        TeacherSubstitution.objects.alive()
        .filter(pk=locked.pk, status=locked.status)
        .update(status=SubstitutionStatus.CANCELLED, updated_by=actor_id, updated_at=timezone.now())
    )
    if not cancelled:
        raise Conflict("This substitution changed while you were cancelling it.")

    substitution.refresh_from_db()
    _notify_cancelled(substitution=substitution)
    return substitution


def _notify_cancelled(*, substitution: TeacherSubstitution) -> None:
    from core.notifications.services import Recipient, notify

    user_id = substitution.substitute_staff.user_id
    if not user_id:
        return
    try:
        with transaction.atomic():
            notify(
                notifications.SUBSTITUTION_CANCELLED,
                tenant_id=substitution.tenant_id,
                recipients=[Recipient(user_id=user_id)],
                context={
                    "substitute.first_name": substitution.substitute_staff.first_name,
                    "section.name": substitution.timetable_slot.section.name,
                    "date": substitution.date.isoformat(),
                    "period.name": substitution.timetable_slot.period.name,
                },
                source_type="teacher_substitution",
                source_id=substitution.pk,
            )
    except Exception:
        logger.exception("substitution-cancelled notification failed for %s", substitution.pk)


def _notify_decision(*, substitution: TeacherSubstitution) -> None:
    from core.notifications.services import Recipient, notify

    if not substitution.created_by:
        return
    try:
        with transaction.atomic():
            notify(
                notifications.SUBSTITUTION_DECISION,
                tenant_id=substitution.tenant_id,
                recipients=[Recipient(user_id=substitution.created_by)],
                context={
                    "section.name": substitution.timetable_slot.section.name,
                    "date": substitution.date.isoformat(),
                    "decision": substitution.status,
                },
                source_type="teacher_substitution",
                source_id=substitution.pk,
            )
    except Exception:
        logger.exception("substitution-decision notification failed for %s", substitution.pk)


# ---------------------------------------------------------------------------
# The absent-teacher feed from attendance (§7.2, §18)
# ---------------------------------------------------------------------------


# Named rather than written inline in the `except`. PEP 758 makes
# `except A, B:` valid on the Python 3.14 this project pins, and ruff's
# formatter rewrites the parenthesised form to it — but it reads as the Python 2
# syntax it is not, and a reviewer stopping to check that is a cost the tuple
# does not have.
_PROPOSAL_REFUSALS = (DomainRuleViolation, Conflict)


def slots_needing_cover(*, staff: Staff, on_date: date) -> list[TimetableSlot]:
    """The published, currently-in-force slots this teacher holds on this date.

    Published only, and current only: a draft cell is not a class anyone is
    expecting, and an end-dated one was superseded. Breaks are excluded because
    `Period.is_break` marks them unschedulable (§5.1) — nobody covers a recess.
    """
    return list(
        TimetableSlot.objects.alive()
        .filter(
            staff=staff,
            status=SlotStatus.PUBLISHED,
            effective_to__isnull=True,
            day_of_week=on_date.weekday(),
            period__is_break=False,
            academic_session__start_date__lte=on_date,
            academic_session__end_date__gte=on_date,
        )
        .select_related("period", "section", "academic_session")
    )


def propose_substitutions_for_absence(
    *,
    staff: Staff,
    on_date: date,
    actor_id: uuid.UUID,
    leave_request_id: uuid.UUID | None = None,
) -> list[TeacherSubstitution]:
    """Propose cover for every class an absent teacher was due to take.

    §18 declares attendance outbound to timetable, and this is that edge —
    `SubstitutionStatus.completed`'s docstring has named it as the missing piece
    since the timetable PR. It lives here, not in attendance, because the rules a
    proposal must satisfy are this module's: `assert_substitution_valid` and the
    two occupancy constraints.

    **Proposals, never confirmations.** §7.2 has a human approve cover, so this
    fills the queue rather than deciding it. A slot that already has open cover
    (proposed or confirmed) for the date is skipped — the unique constraint holds
    one open cover per (slot, date), and re-marking an absence must not raise a
    second proposal. A declined or cancelled one doesn't count: that slot still
    needs cover.

    **A slot with no free substitute is skipped, not failed.** Every eligible
    teacher already teaching that period is an ordinary state in a small school,
    and refusing the whole batch because one period cannot be covered would leave
    the coverable ones uncovered too. The caller logs the shortfall.
    """
    proposed: list[TeacherSubstitution] = []
    away = _staff_away_on(on_date)  # the same for every slot of the day

    for slot in slots_needing_cover(staff=staff, on_date=on_date):
        already = TeacherSubstitution.objects.alive().filter(
            timetable_slot=slot, date=on_date, status__in=OPEN_SUBSTITUTION_STATUSES
        )
        if already.exists():
            continue

        substitute = _first_free_substitute(
            slot=slot, on_date=on_date, absent_staff=staff, away=away
        )
        if substitute is None:
            logger.info(
                "no free substitute for slot %s on %s; leaving it uncovered", slot.pk, on_date
            )
            continue

        try:
            with transaction.atomic():
                proposed.append(
                    create_substitution(
                        slot=slot,
                        on_date=on_date,
                        absent_staff=staff,
                        substitute_staff=substitute,
                        reason="Automatically proposed: the scheduled teacher is absent.",
                        tenant_id=staff.tenant_id,
                        actor_id=actor_id,
                        leave_request_id=leave_request_id,
                    )
                )
        except _PROPOSAL_REFUSALS:
            # A race against another proposal, or a rule this candidate fails on
            # closer inspection. One slot's failure must not cost the rest their
            # cover, and the queue is advisory until a human approves it.
            logger.info("could not propose cover for slot %s on %s", slot.pk, on_date)

    return proposed


def _first_free_substitute(
    *, slot: TimetableSlot, on_date: date, absent_staff: Staff, away: set[uuid.UUID] | None = None
) -> Staff | None:
    """The first of `free_substitutes`, by `pk`. `away` is the day's away set when the caller
    already has it (one lookup for a whole absence, not one per slot).

    Deliberately *first free*, not *best*: §6's ranking and §14's AI-TTB-03 are the
    ranked suggestion (workload balance, subject match), and neither exists yet. Picking
    arbitrarily and letting a human approve is honest. Ordered by `pk` so the choice is
    at least stable across runs.
    """
    return (
        free_substitutes(slot=slot, on_date=on_date, absent_staff=absent_staff, away=away)
        .order_by("pk")
        .first()
    )
