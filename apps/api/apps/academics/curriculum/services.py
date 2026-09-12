"""Business rules for curriculum (`class_subjects`) — academics.md §6, §7, §11.

Views stay thin: everything here is a rule from docs/03-modules/academics.md,
kept out of serializers so the same rules apply to the API, the bulk importer
and the Celery jobs — the layering student_management and staff_management
already use.
"""

from __future__ import annotations

import uuid

from django.db import transaction

from apps.school_organization.models import AcademicSession, Class, ClassSubject
from apps.school_organization.services import assert_session_writable
from core.api.exceptions import DomainRuleViolation


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
