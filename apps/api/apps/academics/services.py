"""Business rules for the academics module.

Views stay thin: everything here is a rule from docs/03-modules/academics.md §6
(sub-features), §7 (workflows) and §11 (validations). Keeping it out of
serializers means the same rules apply to the API, the bulk importer and the
Celery jobs — the layering student_management and staff_management already use.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from datetime import date

from django.db import transaction
from django.db.models import Q
from django.http import Http404
from django.utils import timezone

from apps.academics import notifications
from apps.academics.models import (
    PromotionDecision,
    PromotionStatus,
    StudentPromotion,
    TeacherSubjectAllocation,
)
from apps.school_organization.models import AcademicSession, Class, ClassSubject, Section, Subject
from apps.school_organization.services import assert_session_writable
from apps.staff_management.models import EmploymentStatus, Staff, StaffType
from apps.student_management.models import EnrollmentStatus, StudentEnrollment
from core.api.exceptions import Conflict, DomainRuleViolation

logger = logging.getLogger(__name__)

# §11: "load warnings at tenant-configured norm, hard cap optional". Advisory
# only — the doc calls these warnings, so they ride along in `meta` rather than
# rejecting the write.
DEFAULT_WEEKLY_PERIOD_NORM = 30

# §12's "promotion batch pending approval" goes to the `principal`; the key is
# what the endpoint actually gates on, so it is what the fan-out resolves.
PROMOTION_APPROVAL_KEY = "academics.promotion.approve"


# ---------------------------------------------------------------------------
# Curriculum
# ---------------------------------------------------------------------------


def assert_curriculum_writable(session: AcademicSession) -> None:
    """§11's session lock: closed sessions are read-only for curriculum."""
    assert_session_writable(session)


def assert_elective_group_has_options(
    *, session: AcademicSession, school_class: Class, elective_group: str, exclude_pk=None
) -> None:
    """§11: an elective group needs at least two options to be a choice at all.

    Checked when a row is *removed from* or *added to* a group rather than on
    every write: a group of one is a group being built up, and rejecting the
    first row would make it impossible to create the second.
    """
    if not elective_group:
        return
    siblings = ClassSubject.objects.alive().filter(
        academic_session=session, school_class=school_class, elective_group=elective_group
    )
    if exclude_pk is not None:
        siblings = siblings.exclude(pk=exclude_pk)
    if siblings.count() == 0:
        raise DomainRuleViolation(
            {
                "elective_group": (
                    f"Removing this leaves '{elective_group}' with no options. An elective "
                    "group needs at least two."
                )
            }
        )


def assert_term_plans_reference_session_terms(
    *, session: AcademicSession, term_plans: list | None
) -> None:
    """§11: term plans must reference terms of the same session.

    A plan pointing at another session's term is silently wrong rather than
    loudly broken — it would render, and be attached to the wrong dates — so it
    is worth the extra query.
    """
    if not term_plans:
        return

    referenced = {str(entry.get("term_id")) for entry in term_plans if entry.get("term_id")}
    if not referenced:
        return

    valid = {
        str(pk) for pk in session.terms.filter(deleted_at__isnull=True).values_list("pk", flat=True)
    }
    stray = referenced - valid
    if stray:
        raise DomainRuleViolation(
            {"term_plans": f"These terms do not belong to this session: {', '.join(sorted(stray))}"}
        )


@transaction.atomic
def clone_curriculum(
    *,
    source_session: AcademicSession,
    target_session: AcademicSession,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
) -> dict[str, int]:
    """Copy every curriculum row from one session to another (§5.1, §7.1).

    Skips rows the target already has rather than failing the whole clone: a
    clone re-run after a partial failure, or after someone hand-added a subject,
    should converge rather than refuse. That makes this safe to retry, which is
    what the `202` + job contract implies.
    """
    assert_curriculum_writable(target_session)
    if source_session.pk == target_session.pk:
        raise DomainRuleViolation(
            {"source_academic_session_id": "Source and target sessions must differ."}
        )

    existing = set(
        ClassSubject.objects.alive()
        .filter(academic_session=target_session)
        .values_list("school_class_id", "subject_id", "campus_id")
    )

    to_create = []
    skipped = 0
    for row in ClassSubject.objects.alive().filter(academic_session=source_session):
        key = (row.school_class_id, row.subject_id, row.campus_id)
        if key in existing:
            skipped += 1
            continue
        to_create.append(
            ClassSubject(
                tenant_id=tenant_id,
                academic_session=target_session,
                school_class_id=row.school_class_id,
                subject_id=row.subject_id,
                campus_id=row.campus_id,
                is_elective=row.is_elective,
                elective_group=row.elective_group,
                weekly_periods=row.weekly_periods,
                # Deliberately not copied: syllabus_file_id (last year's document
                # is not this year's) and term_plans (they reference the source
                # session's terms, which assert_term_plans_reference_session_terms
                # would reject on the very next edit).
                notes=row.notes,
                created_by=actor_id,
                updated_by=actor_id,
            )
        )

    if to_create:
        ClassSubject.objects.bulk_create(to_create, batch_size=500)

    return {"created": len(to_create), "skipped": skipped}


# ---------------------------------------------------------------------------
# Teacher allocation
# ---------------------------------------------------------------------------


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


def _end_date_current_primary(
    *, session: AcademicSession, section: Section, subject: Subject, actor_id: uuid.UUID
) -> None:
    """End-date the outgoing primary rather than deleting it (§6).

    "Reassignment mid-session preserves history (old allocation end-dated, not
    deleted)" — and it is also what keeps `tsa_one_primary_per_section_subject`
    satisfiable, since that constraint only counts allocations with no
    `effective_to`.
    """
    TeacherSubjectAllocation.objects.alive().filter(
        academic_session=session,
        section=section,
        subject=subject,
        is_primary=True,
        effective_to__isnull=True,
    ).update(effective_to=timezone.now().date(), updated_by=actor_id, updated_at=timezone.now())


# ---------------------------------------------------------------------------
# Promotion
# ---------------------------------------------------------------------------


def next_class_for(*, from_class: Class, tenant_id: uuid.UUID) -> Class | None:
    """The class one `level` above, or None when there is nothing above it.

    None means "graduating" for the default proposal — the top of the ladder has
    no next rung, which is exactly what `graduated` encodes.
    """
    return (
        Class.objects.alive()
        .filter(level__gt=from_class.level, is_active=True)
        .order_by("level")
        .first()
    )


@transaction.atomic
def create_promotion_batch(
    *,
    from_session: AcademicSession,
    to_session: AcademicSession,
    school_class: Class,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
) -> tuple[uuid.UUID, list[StudentPromotion]]:
    """Propose one decision per actively-enrolled student in `school_class`.

    The proposal is deliberately naive — everyone moves up a level, or graduates
    at the top — because the inputs §7.2 wants (published final results,
    attendance percentages) come from examinations and attendance, neither of
    which exists. `decision_basis` records that explicitly rather than leaving a
    reviewer to assume a rule ran. Reviewers then adjust drafts, which is the
    step the workflow actually gates on.
    """
    if from_session.pk == to_session.pk:
        raise DomainRuleViolation(
            {"to_academic_session_id": "The target session must differ from the source."}
        )
    assert_session_writable(to_session)

    enrollments = list(
        StudentEnrollment.objects.alive()
        .filter(
            academic_session=from_session,
            school_class=school_class,
            status=EnrollmentStatus.ACTIVE,
        )
        .select_related("student")
    )
    if not enrollments:
        raise DomainRuleViolation(
            {"class_id": "No actively enrolled students in this class for that session."}
        )

    # The friendly path, and only that: this read takes no lock, so two
    # simultaneous creates can both pass it and both insert. What actually holds
    # under the race is `promotions_student_live_once` (models.py, where the
    # reasoning lives), whose IntegrityError reaches the client as the same 409.
    existing = (
        StudentPromotion.objects.alive()
        .filter(
            from_academic_session=from_session,
            to_academic_session=to_session,
            from_class=school_class,
        )
        .exclude(status=PromotionStatus.REVERTED)
        .exists()
    )
    if existing:
        raise Conflict("A promotion batch already exists for this class and session pair.")

    target = next_class_for(from_class=school_class, tenant_id=tenant_id)
    batch_id = uuid.uuid4()
    basis = {
        "rule": "level+1",
        "results_available": False,
        "attendance_available": False,
        "note": (
            "Proposed from class level alone. Result and attendance inputs "
            "(academics.md §7.2) arrive with the examinations and attendance modules."
        ),
    }

    rows = [
        StudentPromotion(
            tenant_id=tenant_id,
            batch_id=batch_id,
            student=enrollment.student,
            from_enrollment=enrollment,
            from_academic_session=from_session,
            to_academic_session=to_session,
            from_class=school_class,
            to_class=target,
            decision=(
                PromotionDecision.GRADUATED if target is None else PromotionDecision.PROMOTED
            ),
            decision_basis=basis,
            status=PromotionStatus.DRAFT,
            created_by=actor_id,
            updated_by=actor_id,
        )
        for enrollment in enrollments
    ]
    StudentPromotion.objects.bulk_create(rows, batch_size=500)
    return batch_id, rows


def batch_queryset(batch_id: uuid.UUID, *, for_update: bool = False):
    """The rows of one batch. `for_update` locks them until the transaction ends.

    Opt-in rather than always-on: the read paths (`retrieve`, the execute
    snapshot) have no business taking a row lock over a whole class, and
    `select_for_update` outside a transaction is an error rather than a no-op.
    """
    rows = StudentPromotion.objects.alive().filter(batch_id=batch_id)
    return rows.select_for_update() if for_update else rows


def assert_batch_in_status(*, batch_id: uuid.UUID, expected: str) -> list[StudentPromotion]:
    """Read a batch under a row lock and require every row to be in `expected`.

    The lock is half the check. Every caller is `@transaction.atomic`, so holding
    the rows until commit is what stops a simultaneous `:approve` and `:reject`
    from each passing this check and each writing — which would leave
    `status=rejected` alongside a populated `approved_by`, a state
    `promotions_approval_fields_together` does not forbid because it only couples
    `approved_by` with `approved_at`. `_transition` restates the status in the
    UPDATE's own WHERE as the second layer.
    """
    rows = list(batch_queryset(batch_id, for_update=True))
    if not rows:
        # 404, not 422: a batch id names a resource, and an id belonging to
        # another tenant must be indistinguishable from one that never existed
        # (AGENTS.md invariant 2). `batch_queryset` is tenant-scoped, so both
        # land here identically.
        raise Http404("No such promotion batch.")
    actual = {row.status for row in rows}
    if actual != {expected}:
        raise Conflict(
            f"This batch is {', '.join(sorted(actual))}; the action requires {expected}."
        )
    return rows


def _transition(
    batch_id: uuid.UUID,
    *,
    from_status: str | set[str],
    to_status: str,
    actor_id: uuid.UUID,
    expected_rows: int,
    **extra,
) -> int:
    """Move a whole batch from one status to the next, or move nothing at all.

    The `status` in the WHERE is not redundant with the caller's
    `assert_batch_in_status`: the lock that check takes is what prevents the
    interleaving, and this is what keeps the *write* safe if a later refactor
    drops the lock. A short count means someone else moved the batch between the
    check and here, which is a 409 rather than a partially transitioned batch —
    every row of a batch moves together (§7.2).
    """
    statuses = {from_status} if isinstance(from_status, str) else set(from_status)
    updated = (
        batch_queryset(batch_id)
        .filter(status__in=statuses)
        .update(status=to_status, updated_by=actor_id, updated_at=timezone.now(), **extra)
    )
    if updated != expected_rows:
        raise Conflict("This batch changed while the action was running. Reload and try again.")
    return updated


@transaction.atomic
def submit_batch(*, batch_id: uuid.UUID, actor_id: uuid.UUID) -> int:
    rows = assert_batch_in_status(batch_id=batch_id, expected=PromotionStatus.DRAFT)
    _assert_decisions_complete(rows)
    updated = _transition(
        batch_id,
        from_status=PromotionStatus.DRAFT,
        to_status=PromotionStatus.PENDING_APPROVAL,
        actor_id=actor_id,
        expected_rows=len(rows),
    )
    notify_promotion_pending(rows=rows, tenant_id=rows[0].tenant_id)
    return updated


def _assert_decisions_complete(rows: list[StudentPromotion]) -> None:
    """§11: a decision deviating from the proposal needs a reason.

    Checked at submit rather than on every draft edit, so a reviewer can work
    through a batch in any order without the form fighting them.
    """
    missing = [
        str(row.student_id)
        for row in rows
        if row.decision != _proposed_decision(row) and not row.override_reason
    ]
    if missing:
        raise DomainRuleViolation(
            {
                "override_reason": (
                    "An override reason is required where the decision differs from the "
                    f"proposal. Missing for {len(missing)} student(s)."
                )
            }
        )


def _proposed_decision(row: StudentPromotion) -> str:
    basis = row.decision_basis or {}
    return basis.get("proposed_decision") or (
        PromotionDecision.GRADUATED if row.to_class_id is None else PromotionDecision.PROMOTED
    )


def assert_retention_keeps_the_class(
    *, decision: str | None, from_class_id: uuid.UUID | None, to_class_id: uuid.UUID | None
) -> None:
    """§6: "retained students re-enroll in the same class next session".

    Retention is the one decision whose target class is not a choice — it is
    dictated by where the student already is, and a `retained` row pointing at
    another class is a promotion wearing the wrong label: the source enrollment
    closes as `retained` while the new one lands a level up, and nothing
    downstream would ever question it.

    A plain function over three ids rather than a check on a row, because both
    gates that need it hold different things: the serializer has a half-applied
    payload over an instance, and `_execute_one` has the row. Living here rather
    than only in the serializer is what makes it hold for the importer and any
    later job that writes a decision.
    """
    if decision != PromotionDecision.RETAINED or to_class_id is None:
        return
    if to_class_id != from_class_id:
        raise DomainRuleViolation(
            {"to_class_id": "A retained student re-enrolls in the same class they were in."}
        )


@transaction.atomic
def approve_batch(*, batch_id: uuid.UUID, actor_id: uuid.UUID) -> int:
    """§7.2 / RBAC §2.4: the approver may not be the preparer.

    Checked against `created_by` on the rows themselves rather than an audit
    lookup, because that is the field that records who actually prepared them
    and it cannot drift from the batch.
    """
    rows = assert_batch_in_status(batch_id=batch_id, expected=PromotionStatus.PENDING_APPROVAL)

    preparers = {row.created_by for row in rows if row.created_by}
    if preparers == {actor_id}:
        raise DomainRuleViolation(
            {
                "non_field": (
                    "You prepared this batch, so you cannot approve it. Segregation of duties "
                    "requires a different approver."
                )
            }
        )

    updated = _transition(
        batch_id,
        from_status=PromotionStatus.PENDING_APPROVAL,
        to_status=PromotionStatus.APPROVED,
        actor_id=actor_id,
        expected_rows=len(rows),
        approved_by=actor_id,
        approved_at=timezone.now(),
    )
    notify_promotion_outcome(rows=rows, outcome="approved", tenant_id=rows[0].tenant_id)
    return updated


@transaction.atomic
def reject_batch(*, batch_id: uuid.UUID, actor_id: uuid.UUID) -> int:
    """Send a batch back to draft. Not a terminal state — §7.2's `rejected` edge
    returns to the reviewer, who adjusts and resubmits."""
    rows = assert_batch_in_status(batch_id=batch_id, expected=PromotionStatus.PENDING_APPROVAL)
    updated = _transition(
        batch_id,
        from_status=PromotionStatus.PENDING_APPROVAL,
        to_status=PromotionStatus.DRAFT,
        actor_id=actor_id,
        expected_rows=len(rows),
    )
    notify_promotion_outcome(rows=rows, outcome="returned to draft", tenant_id=rows[0].tenant_id)
    return updated


@transaction.atomic
def revert_batch(*, batch_id: uuid.UUID, actor_id: uuid.UUID) -> int:
    """§7.2: revert is allowed only before downstream activity exists.

    "Downstream" can only mean the enrollments this batch created, because no
    other module that could reference them exists yet. That is a real limit, not
    a complete check — the same shape as student-management's clearance checks,
    which always return "clear" for the same reason. When attendance and
    examinations land, this predicate must grow to consult them.
    """
    rows = list(batch_queryset(batch_id, for_update=True))
    if not rows:
        raise Http404("No such promotion batch.")

    statuses = {row.status for row in rows}
    if statuses == {PromotionStatus.REVERTED}:
        raise Conflict("This batch is already reverted.")

    if PromotionStatus.EXECUTED in statuses:
        created = StudentEnrollment.objects.alive().filter(
            student_id__in=[row.student_id for row in rows],
            academic_session_id=rows[0].to_academic_session_id,
        )
        if created.exists():
            raise Conflict(
                "This batch has already created next-session enrollments. Withdraw or "
                "transfer those enrollments before reverting."
            )

    # Reverting is reachable from four states, so the guard is the set actually
    # observed under the lock rather than one named status.
    return _transition(
        batch_id,
        from_status=statuses,
        to_status=PromotionStatus.REVERTED,
        actor_id=actor_id,
        expected_rows=len(rows),
    )


def _assert_executable(statuses: set[str]) -> None:
    if not statuses:
        # 404 for the same reason `assert_batch_in_status` gives one.
        raise Http404("No such promotion batch.")
    if statuses - {PromotionStatus.APPROVED, PromotionStatus.EXECUTED}:
        raise Conflict("Only an approved batch can be executed.")


def assert_batch_executable(*, batch_id: uuid.UUID) -> None:
    """The preconditions an `:execute` caller is entitled to hear synchronously.

    `:execute` answers `202` and does the work on a worker, so without this the
    only thing separating "queued" from "you asked to execute a draft batch" is
    a job that fails out of band minutes later. Whether a batch is executable at
    all is knowable at request time and does not need a queue to decide, so it
    is decided here and the client keeps the 404/409 the endpoint always gave.
    `execute_batch` re-checks under the worker's own read — this is a courtesy,
    never the guarantee.
    """
    _assert_executable(set(batch_queryset(batch_id).values_list("status", flat=True)))


def execute_batch(
    *,
    batch_id: uuid.UUID,
    tenant_id: uuid.UUID,
    actor_id: uuid.UUID,
    on_progress: Callable[[int], None] | None = None,
) -> dict:
    """Create next-session enrollments for an approved batch. Idempotent.

    Not `@transaction.atomic` around the whole batch, deliberately: this runs as
    a Celery job over potentially hundreds of students, and one student failing
    a prerequisite (§11 requires a guardian and an emergency contact to enroll)
    must not discard the rest. Each student commits or fails on its own and the
    per-student outcome is reported, which is what §7.2's "per-student result
    report" means.

    That per-student commit is the reason `apps/academics/tasks.py` exists and
    the endpoint returns `202`. The `tenant_atomic` each student opens is only a
    real, committing transaction when nothing else has one open; called inside a
    DRF request it nests as a savepoint under `ATOMIC_REQUESTS`, so the isolation
    survives but every row lock is held until the response is rendered and a
    class of hundreds gets no visible progress before the gateway gives up.

    Re-execution is a no-op per row (§11: "re-execution attempts are no-ops"),
    which is what makes the `Idempotency-Key` on the endpoint meaningful beyond
    the 24h replay window.
    """
    from core.tenancy.context import tenant_atomic

    with tenant_atomic(tenant_id):
        rows = list(
            batch_queryset(batch_id).select_related(
                "student", "from_enrollment", "to_academic_session", "to_class"
            )
        )
    _assert_executable({row.status for row in rows})

    report: dict[str, list] = {"enrolled": [], "graduated": [], "skipped": [], "failed": []}

    for index, row in enumerate(rows, start=1):
        if row.status == PromotionStatus.EXECUTED:
            report["skipped"].append(
                {"student_id": str(row.student_id), "reason": "already executed"}
            )
        else:
            try:
                _execute_one(row=row, tenant_id=tenant_id, actor_id=actor_id, report=report)
            except Exception as exc:  # noqa: BLE001 — one student must not fail the batch
                logger.warning("promotion execution failed for student %s", row.student_id)
                report["failed"].append({"student_id": str(row.student_id), "error": str(exc)})
        if on_progress is not None:
            on_progress(round(index / len(rows) * 100))

    return report


def _execute_one(*, row: StudentPromotion, tenant_id: uuid.UUID, actor_id: uuid.UUID, report: dict):
    from apps.student_management.services import enroll_student
    from core.tenancy.context import tenant_atomic

    with tenant_atomic(tenant_id):
        # `execute_batch` iterates a snapshot read before the loop, deliberately
        # (its docstring says why the batch is not one transaction), so by the
        # time this row is reached a concurrent `:revert` may already have moved
        # it. Re-reading it under a lock here narrows that window to the single
        # row about to be written, without giving up the per-student isolation
        # the snapshot buys.
        current = (
            StudentPromotion.objects.alive()
            .select_for_update()
            .filter(pk=row.pk)
            .values_list("status", flat=True)
            .first()
        )
        if current != PromotionStatus.APPROVED:
            report["skipped"].append(
                {
                    "student_id": str(row.student_id),
                    "reason": (
                        f"no longer approved ({current})" if current else "no longer in the batch"
                    ),
                }
            )
            return

        if row.decision == PromotionDecision.GRADUATED:
            _close_source_enrollment(row, EnrollmentStatus.GRADUATED, actor_id)
            _mark_executed(row, actor_id)
            report["graduated"].append({"student_id": str(row.student_id)})
            return

        assert_retention_keeps_the_class(
            decision=row.decision, from_class_id=row.from_class_id, to_class_id=row.to_class_id
        )

        if row.to_section_id is None:
            raise DomainRuleViolation(
                {"to_section_id": "Assign a target section before executing this batch."}
            )

        enroll_student(
            student=row.student,
            academic_session=row.to_academic_session,
            school_class=row.to_class,
            section=Section.objects.alive().get(pk=row.to_section_id),
            enrollment_date=row.to_academic_session.start_date,
            actor_id=actor_id,
            tenant_id=tenant_id,
        )
        closing = (
            EnrollmentStatus.RETAINED
            if row.decision == PromotionDecision.RETAINED
            else EnrollmentStatus.PROMOTED
        )
        _close_source_enrollment(row, closing, actor_id)
        _mark_executed(row, actor_id)
        report["enrolled"].append({"student_id": str(row.student_id)})


def _close_source_enrollment(row: StudentPromotion, status: str, actor_id: uuid.UUID) -> None:
    StudentEnrollment.objects.alive().filter(
        pk=row.from_enrollment_id, status=EnrollmentStatus.ACTIVE
    ).update(status=status, updated_by=actor_id, updated_at=timezone.now())


def _mark_executed(row: StudentPromotion, actor_id: uuid.UUID) -> None:
    now = timezone.now()
    StudentPromotion.objects.alive().filter(pk=row.pk).update(
        status=PromotionStatus.EXECUTED, executed_at=now, updated_by=actor_id, updated_at=now
    )


# ---------------------------------------------------------------------------
# Notifications (academics.md §12)
# ---------------------------------------------------------------------------


def notify_allocation_changed(
    *, allocation: TeacherSubjectAllocation, tenant_id: uuid.UUID
) -> None:
    """Never lets a notification failure undo the allocation — see
    staff_management.services._notify_invited for the same reasoning."""
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


def _promotion_approvers(tenant_id: uuid.UUID) -> set[uuid.UUID]:
    """Everyone in this tenant who holds `academics.promotion.approve`.

    §12 addresses this to the `principal`, but a role is only ever a bundle of
    permission keys (auth-and-rbac.md) — a school that moved approval onto a
    custom role would otherwise be told nothing. Resolved the same way
    `core.rbac.permissions.effective_permission_keys` resolves it, so the people
    notified are exactly the people the endpoint would let through.
    """
    from core.rbac.models import User

    return set(
        User.objects.filter(
            tenant_id=tenant_id,
            is_active=True,
            deleted_at__isnull=True,
            user_roles__deleted_at__isnull=True,
            user_roles__role__permissions__key=PROMOTION_APPROVAL_KEY,
        ).values_list("pk", flat=True)
    )


def notify_promotion_pending(*, rows: list[StudentPromotion], tenant_id: uuid.UUID) -> None:
    """§12: a submitted batch tells the people who can approve it.

    Same shape as `notify_allocation_changed` above — recipients resolved to a
    set, nothing sent when it is empty, and the send savepointed and swallowed so
    a template or transport fault cannot undo a transition that already
    happened.
    """
    from core.notifications.services import Recipient, notify

    # Preparers are subtracted rather than merely redundant: `approve_batch`
    # refuses an approver who prepared the batch, so asking them to approve it
    # would be an instruction the API is going to reject.
    preparers = {row.created_by for row in rows if row.created_by}
    recipients = _promotion_approvers(tenant_id) - preparers
    if not recipients:
        return

    batch = rows[0]
    try:
        with transaction.atomic():
            notify(
                notifications.PROMOTION_PENDING,
                tenant_id=tenant_id,
                recipients=[Recipient(user_id=user_id) for user_id in sorted(recipients)],
                context={
                    "class.name": batch.from_class.name,
                    "student.count": len(rows),
                    "session.name": batch.to_academic_session.name,
                },
                source_type="student_promotion_batch",
                source_id=batch.batch_id,
            )
    except Exception:
        logger.exception("promotion-pending notification failed for batch %s", batch.batch_id)


def notify_promotion_outcome(
    *, rows: list[StudentPromotion], outcome: str, tenant_id: uuid.UUID
) -> None:
    """The approval decision, told back to whoever prepared the batch.

    `created_by` is the same field `approve_batch` segregates duties against, so
    the recipient cannot drift from the batch. See notifications.py's header for
    why this trigger reads as a batch outcome rather than §12's per-student note
    to guardians.
    """
    from core.notifications.services import Recipient, notify

    recipients = {row.created_by for row in rows if row.created_by}
    if not recipients:
        return

    batch = rows[0]
    try:
        with transaction.atomic():
            notify(
                notifications.PROMOTION_OUTCOME,
                tenant_id=tenant_id,
                recipients=[Recipient(user_id=user_id) for user_id in sorted(recipients)],
                context={
                    "class.name": batch.from_class.name,
                    "student.count": len(rows),
                    "decision": outcome,
                    "session.name": batch.to_academic_session.name,
                },
                source_type="student_promotion_batch",
                source_id=batch.batch_id,
            )
    except Exception:
        logger.exception("promotion-outcome notification failed for batch %s", batch.batch_id)
