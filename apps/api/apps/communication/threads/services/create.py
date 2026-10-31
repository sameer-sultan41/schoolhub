"""Start a thread with its first message.

Three shapes, each with its own rule for who takes part:

- A **guardian or student** (a restricted principal) may only start a
  `guardian_school` thread, about a child they still own, and does not choose
  the staff side: `routing.route_guardian_thread` does.
- **Staff** starting a `guardian_school` thread pick a student inside their own
  record scope; the guardians who both have portal access and receive
  communications for that child join.
- **Staff** starting an `internal` (one colleague) or `group` (two or more)
  thread name the colleagues, every one of whom must be active staff of this
  tenant.

Every miss on a student or a participant is a 404 for the whole request, never a
partial thread: whether a student or user exists in another school, or outside
the caller's scope, is not the caller's to learn (AGENTS.md invariant 2).
"""

from __future__ import annotations

import uuid

from django.db import transaction
from django.http import Http404

from apps.communication.models import MessageThread, ThreadStatus, ThreadType
from apps.communication.threads.routing import route_guardian_thread, thread_staff_users
from apps.communication.threads.services.post_message import post_message
from apps.student_management.models import Student, StudentGuardian
from core.api.exceptions import DomainRuleViolation
from core.rbac.permissions import is_restricted_principal, scope_queryset

# A `group` thread is the caller plus at least this many colleagues; one
# colleague is an `internal` thread.
GROUP_MIN_OTHER_PARTICIPANTS = 2


def create_thread(
    *,
    actor,
    tenant_id: uuid.UUID,
    subject: str,
    thread_type: str,
    student_id: uuid.UUID | None,
    participant_user_ids: list[uuid.UUID],
    body: str,
    attachments: list | None,
) -> MessageThread:
    student = None
    assigned_to = None
    if is_restricted_principal(actor):
        if thread_type != ThreadType.GUARDIAN_SCHOOL:
            raise DomainRuleViolation(
                {"thread_type": "Guardians and students can only start a guardian-school thread."}
            )
        student = _owned_student(actor=actor, student_id=student_id)
        others, assigned_to = route_guardian_thread(student=student, tenant_id=tenant_id)
    elif thread_type == ThreadType.GUARDIAN_SCHOOL:
        student = _scoped_student(actor=actor, student_id=student_id)
        others = _guardian_user_ids(student=student, tenant_id=tenant_id)
        # The staff member who opened the conversation is the one answerable for it.
        assigned_to = actor.pk
    else:
        others = _colleague_user_ids(
            actor=actor,
            tenant_id=tenant_id,
            thread_type=thread_type,
            participant_user_ids=participant_user_ids,
        )

    participants = list(dict.fromkeys([str(actor.pk), *(str(uid) for uid in others)]))
    with transaction.atomic():
        thread = MessageThread.objects.create(
            tenant_id=tenant_id,
            subject=subject,
            thread_type=thread_type,
            student=student,
            participant_user_ids=participants,
            assigned_to_id=assigned_to,
            status=ThreadStatus.OPEN,
            created_by=actor.pk,
            updated_by=actor.pk,
        )
        post_message(
            thread=thread,
            sender=actor,
            body=body,
            attachments=attachments,
            is_internal_note=False,
        )
    return thread


def _require_student_id(student_id: uuid.UUID | None) -> uuid.UUID:
    if student_id is None:
        raise DomainRuleViolation({"student_id": "A guardian-school thread needs a student."})
    return student_id


def _owned_student(*, actor, student_id: uuid.UUID | None) -> Student:
    """A child the guardian (or the student themself) still owns — portal access included."""
    owned = Student.filter_owned_by_user(Student.objects.alive(), actor)
    student = owned.filter(pk=_require_student_id(student_id)).first()
    if student is None:
        raise Http404("No such student.")
    return student


def _scoped_student(*, actor, student_id: uuid.UUID | None) -> Student:
    """A student inside the staff member's record scope, scoped as `/students` scopes them."""
    scoped = scope_queryset(Student.objects.alive(), actor, own_field="user_id")
    student = scoped.filter(pk=_require_student_id(student_id)).first()
    if student is None:
        raise Http404("No such student.")
    return student


def _guardian_user_ids(*, student: Student, tenant_id: uuid.UUID) -> list[uuid.UUID]:
    """Guardians who can both sign in and receive communications about ``student``.

    A guardian without portal access could never read the thread, and one who has
    opted out of communications for this child has asked not to be messaged.
    """
    from core.rbac.models import User

    active_user_ids = User.objects.filter(
        tenant_id=tenant_id, is_active=True, deleted_at__isnull=True
    ).values("pk")
    user_ids = list(
        StudentGuardian.objects.alive()
        .filter(
            student=student,
            has_portal_access=True,
            receives_communications=True,
            guardian__deleted_at__isnull=True,
            guardian__user_id__in=active_user_ids,
        )
        .order_by("guardian__user_id")
        .values_list("guardian__user_id", flat=True)
        .distinct()
    )
    if not user_ids:
        raise DomainRuleViolation(
            {"student_id": "No guardian of this student can receive messages."}
        )
    return user_ids


def _colleague_user_ids(
    *,
    actor,
    tenant_id: uuid.UUID,
    thread_type: str,
    participant_user_ids: list[uuid.UUID],
) -> list[uuid.UUID]:
    requested = list(dict.fromkeys(uid for uid in participant_user_ids if uid != actor.pk))
    staff = thread_staff_users(tenant_id=tenant_id).filter(pk__in=requested)
    found = set(staff.values_list("pk", flat=True))
    if found != set(requested):
        raise Http404("No such user.")

    if thread_type == ThreadType.INTERNAL and len(requested) != 1:
        raise DomainRuleViolation(
            {"participant_user_ids": "An internal thread is with exactly one colleague."}
        )
    if thread_type == ThreadType.GROUP and len(requested) < GROUP_MIN_OTHER_PARTICIPANTS:
        raise DomainRuleViolation(
            {"participant_user_ids": "A group thread needs at least two colleagues."}
        )
    return requested
