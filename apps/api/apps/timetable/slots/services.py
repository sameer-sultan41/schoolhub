"""Business rules for `timetable-slots`, `:validate`/`:publish` and
`GET /timetables/my`.

Views stay thin: every rule that needs more than the request body lives here, so
the API, a future bulk importer and the substitution feed from attendance all
apply the same checks. The conflict engine itself is `slots/conflicts.py`.
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
from apps.timetable import notifications
from apps.timetable.models import SlotStatus, SubstitutionStatus, TeacherSubstitution, TimetableSlot
from apps.timetable.slots.conflicts import detect_conflicts, has_hard_conflicts
from core.api.exceptions import Conflict, DomainRuleViolation

logger = logging.getLogger(__name__)


def assert_slot_writable(slot: TimetableSlot) -> None:
    """Published slots are edited by republishing, never in place (§5.7).

    Editing a live cell would change what students already read without the
    validation and notification a publish carries.
    """
    if slot.status == SlotStatus.PUBLISHED:
        raise Conflict(
            "This slot is published. Edit the draft and republish rather than changing it in place."
        )


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
    `viewset.MyTimetableViewSet` first resolves *which sections* to look in. If
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
