"""Business rules for the timetable module.

Views stay thin: every rule that needs more than the request body lives here, so
the API, a future bulk importer and the substitution feed from attendance all
apply the same checks. The conflict engine itself is `conflicts.py`.
"""

from __future__ import annotations

import logging
import operator
import uuid
from datetime import date
from functools import reduce

from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from apps.school_organization.models import AcademicSession, Section
from apps.school_organization.services import assert_session_writable
from apps.staff_management.models import EmploymentStatus, Staff, StaffType
from apps.timetable import notifications
from apps.timetable.conflicts import detect_conflicts, has_hard_conflicts
from apps.timetable.models import (
    Period,
    Room,
    SlotStatus,
    SubstitutionStatus,
    TeacherSubstitution,
    TimetableSlot,
)
from core.api.exceptions import Conflict, DomainRuleViolation

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Periods
# ---------------------------------------------------------------------------


def assert_period_does_not_overlap(
    *, campus_id: uuid.UUID | None, start_time, end_time, exclude_pk=None
) -> None:
    """§11: periods must not overlap within a day template.

    Compared against both the campus's own periods and the tenant-wide ones
    (`campus_id IS NULL`), because a tenant-wide period applies to this campus
    too — checking only the campus's own rows would let a campus period sit
    inside the tenant's lunch break.
    """
    siblings = Period.objects.alive().filter(Q(campus_id=campus_id) | Q(campus_id__isnull=True))
    if exclude_pk is not None:
        siblings = siblings.exclude(pk=exclude_pk)

    clash = siblings.filter(start_time__lt=end_time, end_time__gt=start_time).first()
    if clash is not None:
        raise DomainRuleViolation(
            {
                "start_time": (
                    f"This overlaps '{clash.name}' ({clash.start_time}-{clash.end_time}). "
                    "Periods in one day template may not overlap."
                )
            }
        )


# ---------------------------------------------------------------------------
# Slots
# ---------------------------------------------------------------------------


def assert_slot_writable(slot: TimetableSlot) -> None:
    """Published slots are edited by republishing, never in place (§5.7).

    Editing a live cell would change what students already read without the
    validation and notification a publish carries.
    """
    if slot.status == SlotStatus.PUBLISHED:
        raise Conflict(
            "This slot is published. Edit the draft and republish rather than changing it in place."
        )


def assert_staff_is_active_teacher(staff: Staff) -> None:
    if staff.employment_status != EmploymentStatus.ACTIVE:
        raise DomainRuleViolation({"staff_id": "This staff member is not active."})
    if staff.staff_type != StaffType.TEACHING:
        raise DomainRuleViolation({"staff_id": "Only teaching staff can be scheduled."})


def conflicts_for(*, session: AcademicSession, section: Section | None = None) -> list[dict]:
    return detect_conflicts(session=session, section=section)


@transaction.atomic
def publish_section_timetable(
    *, session: AcademicSession, section: Section, actor_id: uuid.UUID
) -> dict:
    """Promote a section's draft to published, superseding the cells it replaces.

    Refuses on any hard conflict (§11), and returns the conflict list so the
    caller can render exactly what to fix rather than a bare failure.

    Supersede, not replace: the outgoing published rows are end-dated rather than
    deleted, so a mid-session revision keeps the history of what was actually in
    force when — which is what attendance and examinations will be reconciled
    against later.

    **Cell by cell, not version by version.** §5.7 and §7.1 describe a whole-grid
    "version n+1", which would make the draft set a complete week and justify
    end-dating everything the section has live. Nothing materialises that full
    draft grid: the builder drafts one row per edited cell, so retiring every
    live row would take Tuesday through Friday down because Monday's first period
    changed. A published cell is therefore end-dated only where a draft exists to
    take its place.

    **The consequence: a published cell cannot be removed.** Deletion was only
    ever expressible as "the next version omits it", and this makes publish
    incremental rather than a whole-version swap, so an omission now means "leave
    it alone" instead. There is no other way to clear a live cell — `:publish`
    will not do it and `DELETE /timetable-slots/{id}` refuses a published row
    (`assert_slot_writable`). Closing that needs a decision about what removal
    means, not a filter change here; docs/project-status.md records it.
    """
    assert_session_writable(session)

    found = detect_conflicts(session=session, section=section)
    if has_hard_conflicts(found):
        # The conflict list goes in `meta`, not `detail`: the exception handler
        # flattens `detail` into `{field, issue}` strings, which would turn
        # `slot_ids` into one entry per id and leave `fieldErrors()` holding only
        # the first — the grid would highlight one side of a double booking and
        # not the other. `meta` passes through as JSON.
        raise DomainRuleViolation(
            {
                "non_field": (
                    "This timetable has unresolved hard conflicts and cannot be published."
                )
            },
            meta={"conflicts": found},
        )

    drafts = list(
        TimetableSlot.objects.alive().filter(
            academic_session=session,
            section=section,
            status=SlotStatus.DRAFT,
            effective_to__isnull=True,
        )
    )
    if not drafts:
        raise DomainRuleViolation(
            {"non_field": "There is no draft timetable for this section to publish."}
        )

    now = timezone.now()
    # One OR'd predicate built from the drafts already in memory, not a lookup
    # per cell: a section's week is forty-odd rows and this runs on every
    # publish. `day_of_week__in=... , period__in=...` would be the cross product
    # and would retire (Mon, p2) because the drafts happened to cover (Mon, p1)
    # and (Tue, p2).
    replaced = reduce(
        operator.or_,
        (
            Q(day_of_week=day_of_week, period_id=period_id)
            for day_of_week, period_id in {(d.day_of_week, d.period_id) for d in drafts}
        ),
    )
    superseded = (
        TimetableSlot.objects.alive()
        .filter(
            replaced,
            academic_session=session,
            section=section,
            status=SlotStatus.PUBLISHED,
            effective_to__isnull=True,
        )
        .update(effective_to=now.date(), updated_by=actor_id, updated_at=now)
    )

    published = (
        TimetableSlot.objects.alive()
        .filter(pk__in=[d.pk for d in drafts])
        .update(
            status=SlotStatus.PUBLISHED,
            effective_from=now.date(),
            updated_by=actor_id,
            updated_at=now,
        )
    )

    _notify_published(session=session, section=section)
    return {"published": published, "superseded": superseded, "conflicts": found}


def _notify_published(*, session: AcademicSession, section: Section) -> None:
    """Notify the section's teachers.

    Students and guardians are §12 recipients too, but resolving a whole
    section's families is recipient-rule work that belongs with the communication
    module — see notifications.py, which records the gap rather than half-doing it.
    A notification failure never undoes a publish.
    """
    from core.notifications.services import Recipient, notify

    staff_user_ids = {
        user_id
        for user_id in TimetableSlot.objects.alive()
        .filter(
            academic_session=session,
            section=section,
            status=SlotStatus.PUBLISHED,
            effective_to__isnull=True,
            staff__isnull=False,
        )
        .values_list("staff__user_id", flat=True)
        if user_id
    }
    if not staff_user_ids:
        return

    try:
        with transaction.atomic():
            notify(
                notifications.PUBLISHED,
                tenant_id=section.tenant_id,
                recipients=[Recipient(user_id=user_id) for user_id in staff_user_ids],
                context={"section.name": section.name, "session.name": session.name},
                source_type="section",
                source_id=section.pk,
            )
    except Exception:
        logger.exception("timetable.published notification failed for section %s", section.pk)


# ---------------------------------------------------------------------------
# Substitutions
# ---------------------------------------------------------------------------


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

    _assert_substitute_is_free(slot=slot, on_date=on_date, substitute_staff=substitute_staff)


def _slot_weekday(slot: TimetableSlot) -> int:
    """`day_of_week` is 0-6 with the week's start set per tenant, while
    `date.weekday()` is always Monday-based. They coincide only while the tenant
    starts its week on Monday, which every seeded tenant does today — a real
    conversion belongs with the tenant week-start setting that does not exist yet."""
    return slot.day_of_week


def _assert_substitute_is_free(
    *, slot: TimetableSlot, on_date: date, substitute_staff: Staff
) -> None:
    """The substitute must be free at that (date, period) — §11.

    Two ways to be busy: their own published slot in that cell, or another
    substitution already covering that cell on that date.

    The second half is also `subs_substitute_one_per_period`, which is what
    actually holds when two proposals race; this check is the friendly half,
    naming the field and the reason instead of answering a bare 409. The first
    half spans two tables and no index can express it, so a substitute whose own
    class is published in that period is caught here or nowhere.
    """
    own_class = (
        TimetableSlot.objects.alive()
        .filter(
            academic_session=slot.academic_session,
            staff=substitute_staff,
            day_of_week=slot.day_of_week,
            period=slot.period,
            status=SlotStatus.PUBLISHED,
            effective_to__isnull=True,
        )
        .exists()
    )
    if own_class:
        raise DomainRuleViolation(
            {"substitute_staff_id": "This teacher already has a class in that period."}
        )

    already_covering = (
        TeacherSubstitution.objects.alive()
        .filter(
            substitute_staff=substitute_staff,
            date=on_date,
            period=slot.period,
            status__in=(SubstitutionStatus.PROPOSED, SubstitutionStatus.CONFIRMED),
        )
        .exists()
    )
    if already_covering:
        raise DomainRuleViolation(
            {
                "substitute_staff_id": (
                    "This teacher is already covering another class in that period."
                )
            }
        )


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
            status__in=(SubstitutionStatus.PROPOSED, SubstitutionStatus.CONFIRMED),
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
# The effective timetable (GET /timetables/my)
# ---------------------------------------------------------------------------


def slot_version_window(on_date: date | None):
    """Which published version of a cell was in force on `on_date`.

    Half-open, `[effective_from, effective_to)`. `publish_section_timetable`
    stamps the outgoing rows' `effective_to` and the incoming rows'
    `effective_from` with the *same* day, so an inclusive upper bound would
    return both versions of every cell on a changeover day. A null
    `effective_from` means "has always been in force".

    Shared rather than inlined because two callers need it and they must agree:
    `effective_slots_for` picks the cells, and the teacher projection in
    `views.MyTimetableViewSet` first resolves *which sections* to look in. If
    only one of them honoured the date, a teacher who held a section only in the
    superseded version would resolve an empty section set and get an empty week
    back for a past date — version-blindness moved one layer up rather than
    fixed.
    """
    if on_date is None:
        return Q(effective_to__isnull=True)
    return Q(Q(effective_from__isnull=True) | Q(effective_from__lte=on_date)) & Q(
        Q(effective_to__isnull=True) | Q(effective_to__gt=on_date)
    )


def effective_slots_for(*, session: AcademicSession, section_ids: list, on_date: date | None):
    """Published slots, with confirmed substitutions applied for `on_date`.

    Date-aware in two distinct ways, and both matter:

    1. **Which version was in force.** `publish_section_timetable` supersedes by
       end-dating rather than deleting, precisely so a past date can be read back
       as it actually was. A query that only ever took `effective_to IS NULL`
       would store that history and then never use it — asking for last month
       would answer with today's grid, and the attendance and examinations
       reconciliation the supersede design exists for would silently compare
       against the wrong week.
    2. **Which substitutions applied.** A substitution overrides one cell for
       specific dates only (§7.2).

    Without a date there is no version to choose, so the current one is the
    answer — that is the base grid the grid UI renders. `slot_version_window`
    is where that choice is spelled out.
    """
    slots = list(
        TimetableSlot.objects.alive()
        .filter(
            slot_version_window(on_date),
            academic_session=session,
            section_id__in=section_ids,
            status=SlotStatus.PUBLISHED,
        )
        .select_related("period", "subject", "staff", "room", "section")
    )
    if on_date is None:
        return slots, {}

    overrides = {
        row.timetable_slot_id: row
        for row in TeacherSubstitution.objects.alive()
        .filter(
            timetable_slot_id__in=[s.pk for s in slots],
            date=on_date,
            status=SubstitutionStatus.CONFIRMED,
        )
        .select_related("substitute_staff", "room")
    }
    return slots, overrides


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
    fills the queue rather than deciding it. A slot that already has a
    substitution for the date is skipped — the unique constraint says one per
    (slot, date), and re-marking an absence must not raise a second proposal.

    **A slot with no free substitute is skipped, not failed.** Every eligible
    teacher already teaching that period is an ordinary state in a small school,
    and refusing the whole batch because one period cannot be covered would leave
    the coverable ones uncovered too. The caller logs the shortfall.
    """
    proposed: list[TeacherSubstitution] = []

    for slot in slots_needing_cover(staff=staff, on_date=on_date):
        already = TeacherSubstitution.objects.alive().filter(timetable_slot=slot, date=on_date)
        if already.exists():
            continue

        substitute = _first_free_substitute(slot=slot, on_date=on_date, absent_staff=staff)
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
    *, slot: TimetableSlot, on_date: date, absent_staff: Staff
) -> Staff | None:
    """An active teacher **at the slot's own campus** who is free for its period.

    The campus filter is not an optimisation. Without it a multi-campus tenant
    proposed cover across sites — a teacher at the other end of the city assigned
    to a period they cannot physically reach, and an approver with no reason to
    notice, because the proposal looks exactly like a valid one. `sections` carry
    a campus and `staff` carry a campus; nothing else in the conflict rules
    compares them, because every other path starts from a grid a human built for
    one campus.

    Deliberately *first free*, not *best*: §14's AI-TTB-03 is the ranked
    suggestion (workload balance, subject match) and it is Phase 3 work behind
    the AI gateway that does not exist. Picking arbitrarily and letting a human
    approve is honest; inventing a ranking here would be a worse version of a
    feature the module doc already specifies properly.

    Ordered by `pk` so the choice is at least stable across runs — an arbitrary
    pick that changes between two identical calls is harder to reason about than
    an arbitrary pick that does not.
    """
    candidates = (
        Staff.objects.alive()
        .filter(
            employment_status=EmploymentStatus.ACTIVE,
            staff_type=StaffType.TEACHING,
            campus_id=slot.section.campus_id,
        )
        .exclude(pk=absent_staff.pk)
        .order_by("pk")
    )

    for candidate in candidates:
        try:
            _assert_substitute_is_free(slot=slot, on_date=on_date, substitute_staff=candidate)
        except DomainRuleViolation:
            continue
        return candidate
    return None
