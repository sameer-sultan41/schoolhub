"""Portal accounts for guardians and students (ADR-0033).

Eligibility, used by the invite, by the accept-time hook and by revocation:

- a student is eligible while their status is ``active`` and they hold an ``active``
  enrollment. Withdrawal, outgoing transfer and graduation each close the enrollment;
  graduation leaves ``Student.status`` alone, so the enrollment is what catches it;
- a guardian is eligible while at least one live link with ``has_portal_access`` points
  at an eligible student. A guardian with two children keeps the account when one leaves.

Revocation (``sync_portal_account``) only ever deactivates. Re-inviting is the one way
back in, and accepting re-checks eligibility.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable

from django.db import transaction
from django.db.models import (
    Case,
    CharField,
    Exists,
    F,
    OuterRef,
    QuerySet,
    Subquery,
    TextChoices,
    Value,
    When,
)
from django.db.models.functions import Now
from rest_framework import serializers

from apps.parent_portal.features import FEATURE as PORTAL_FEATURE
from apps.student_management.models import (
    EnrollmentStatus,
    Guardian,
    Student,
    StudentEnrollment,
    StudentGuardian,
    StudentStatus,
)
from core.audit.services import record_task_security_event
from core.rbac.invitations.exceptions import (
    AlreadyActive,
    EmailInUse,
    NotEligible,
    PortalDisabled,
)
from core.rbac.invitations.services import (
    assert_email_free,
    create_invitation,
    create_invited_user,
    revoke_pending_invitations,
)
from core.rbac.models import Invitation, InvitationKind, Role, User, UserRole
from core.rbac.registry import registry
from core.rbac.seeding import ensure_role_with_permissions
from core.rbac.sessions import revoke_refresh_tokens
from core.tenancy.features import is_feature_enabled
from core.tenancy.models import Tenant

logger = logging.getLogger(__name__)

DEACTIVATED_EVENT = "auth.account.deactivated"


class PortalStatus(TextChoices):
    NONE = "none", "No account"
    INVITED = "invited", "Invited"
    EXPIRED = "expired", "Invitation expired"
    SEND_FAILED = "send_failed", "Invitation not delivered"
    ACTIVE = "active", "Active"
    INACTIVE = "inactive", "Inactive"


# ---------------------------------------------------------------------------
# Eligibility
# ---------------------------------------------------------------------------


def _has_active_enrollment(student_ref: str) -> Exists:
    return Exists(
        StudentEnrollment.objects.alive().filter(
            student_id=OuterRef(student_ref), status=EnrollmentStatus.ACTIVE
        )
    )


def student_is_eligible(student: Student) -> bool:
    return (
        Student.objects.alive()
        .filter(pk=student.pk, status=StudentStatus.ACTIVE)
        .filter(_has_active_enrollment("pk"))
        .exists()
    )


def guardian_is_eligible(guardian: Guardian) -> bool:
    if guardian.deleted_at is not None:
        return False
    return (
        StudentGuardian.objects.alive()
        .filter(
            guardian_id=guardian.pk,
            has_portal_access=True,
            student__deleted_at__isnull=True,
            student__status=StudentStatus.ACTIVE,
        )
        .filter(_has_active_enrollment("student_id"))
        .exists()
    )


def guardian_invitation_eligible(user: User) -> bool:
    """The `guardian` eligibility hook, re-checked when the invitation is accepted."""
    guardian = Guardian.objects.alive().filter(user_id=user.pk).first()
    return guardian is not None and guardian_is_eligible(guardian)


def student_invitation_eligible(user: User) -> bool:
    """The `student` eligibility hook, re-checked when the invitation is accepted."""
    student = Student.objects.alive().filter(user_id=user.pk).first()
    return student is not None and student_is_eligible(student)


# ---------------------------------------------------------------------------
# Invite
# ---------------------------------------------------------------------------


def invite_to_portal(
    *, person: Guardian | Student, actor_id: uuid.UUID, email: str | None = None
) -> User:
    """Create or reuse ``person``'s portal account and email them an invitation.

    ``person`` is re-read under a row lock, so two concurrent invites for one person run
    in turn: the second finds the first's account and resends rather than creating a
    second user. ``email`` is the student's address from the request body; a guardian's
    comes from ``Guardian.email``. Once an account is linked, a resend goes to that
    account's own address and ``email`` is not used.
    """
    if isinstance(person, Guardian):
        return _invite_guardian(guardian=person, actor_id=actor_id)
    return _invite_student(student=person, actor_id=actor_id, email=email)


@transaction.atomic
def _invite_guardian(*, guardian: Guardian, actor_id: uuid.UUID) -> User:
    locked = Guardian.objects.select_for_update().get(pk=guardian.pk)
    return _invite(
        person=locked,
        kind=InvitationKind.GUARDIAN,
        address=locked.email,
        eligible=lambda: guardian_is_eligible(locked),
        actor_id=actor_id,
    )


@transaction.atomic
def _invite_student(*, student: Student, actor_id: uuid.UUID, email: str | None) -> User:
    locked = Student.objects.select_for_update().get(pk=student.pk)
    return _invite(
        person=locked,
        kind=InvitationKind.STUDENT,
        address=email,
        eligible=lambda: student_is_eligible(locked),
        actor_id=actor_id,
    )


def _invite(
    *,
    person: Guardian | Student,
    kind: str,
    address: str | None,
    eligible: Callable[[], bool],
    actor_id: uuid.UUID,
) -> User:
    """The shared steps, on a ``person`` already locked by the caller."""
    tenant_id: uuid.UUID = person.tenant_id
    if not is_feature_enabled(PORTAL_FEATURE, tenant_id=tenant_id):
        raise PortalDisabled()

    user = None
    if person.user_id is not None:
        user = User.objects.filter(
            pk=person.user_id, tenant_id=tenant_id, deleted_at__isnull=True
        ).first()

    resolved = (address or "").strip()
    if user is None:
        if not resolved:
            raise serializers.ValidationError(
                {"email": ["An email address is required to invite this person."]}
            )
        assert_email_free(tenant_id=tenant_id, email=resolved)
    elif not is_portal_account(user.pk, kind=kind):
        # Linked to staff, to the other kind of person, or holding a staff role: inviting
        # would add a restricted role to someone else's login.
        raise EmailInUse()

    if not eligible():
        raise NotEligible()

    if user is not None:
        if user.is_active:
            raise AlreadyActive()
        _assign_portal_role(user=user, slug=kind, tenant_id=tenant_id)
        create_invitation(user=user, kind=kind, actor_id=actor_id)
        return user

    user = create_invited_user(
        tenant_id=tenant_id,
        email=resolved,
        first_name=person.first_name,
        last_name=person.last_name,
        phone=getattr(person, "phone", "") or "",
    )
    _assign_portal_role(user=user, slug=kind, tenant_id=tenant_id)

    person.user_id = user.pk
    person.updated_by = actor_id
    person.save(update_fields=["user_id", "updated_by", "updated_at"])

    create_invitation(user=user, kind=kind, actor_id=actor_id)
    return user


def is_portal_account(user_id: uuid.UUID, *, kind: str) -> bool:
    """Whether ``user_id`` is purely a ``kind`` portal login, safe to invite or deactivate.

    Not if it is linked to a staff row or to a person of the other kind, or holds any role
    that is not a restricted principal. Since ``user_id`` became read-only this only
    guards rows linked before that, or by hand; deactivating or adding a role to such an account
    would act on someone else's login.
    """
    from apps.staff_management.models import Staff

    other: type[Guardian] | type[Student] = Student if kind == InvitationKind.GUARDIAN else Guardian
    return not (
        Staff.objects.alive().filter(user_id=user_id).exists()
        or other.objects.alive().filter(user_id=user_id).exists()
        or UserRole.objects.filter(user_id=user_id, role__is_restricted_principal=False).exists()
    )


def _portal_role(*, tenant_id: uuid.UUID, slug: str) -> Role:
    """The school's ``guardian``/``student`` role, created from the registry if missing.

    A school's own role of that slug wins over a platform default. No migration seeds
    these roles, so the first invite creates the tenant's one, restricted, holding
    exactly the keys the registry gives the slug (ADR-0033).
    """
    role = (
        Role.objects.filter(slug=slug, deleted_at__isnull=True, tenant_id=tenant_id).first()
        or Role.objects.filter(slug=slug, deleted_at__isnull=True, tenant__isnull=True).first()
    )
    if role is not None:
        return role
    return ensure_role_with_permissions(
        Tenant.objects.get(pk=tenant_id),
        slug,
        slug.title(),
        registry.keys_for_role(slug),
        is_restricted_principal=True,
    )


def _assign_portal_role(*, user: User, slug: str, tenant_id: uuid.UUID) -> None:
    role = _portal_role(tenant_id=tenant_id, slug=slug)
    if not UserRole.objects.filter(user=user, role=role).exists():
        UserRole.objects.create(user=user, role=role, tenant_id=tenant_id)


# ---------------------------------------------------------------------------
# Revocation
# ---------------------------------------------------------------------------


def _person_of[P: (Guardian, Student)](model: type[P], user_id: uuid.UUID) -> P | None:
    """The row linked to ``user_id``, a live one first; a deleted one still counts."""
    return (
        model.objects.filter(user_id=user_id)
        .order_by(F("deleted_at").asc(nulls_first=True))
        .first()
    )


@transaction.atomic
def sync_portal_account(user_id: uuid.UUID | None, *, actor_id: uuid.UUID | None = None) -> None:
    """Deactivate ``user_id``'s portal account if its guardian or student lost eligibility.

    Deactivates, revokes pending invitations and blacklists refresh tokens. Never
    reactivates: a person who becomes eligible again is re-invited. A user who is not
    purely a guardian or student login (staff, or both kinds) is left alone and logged.
    Call it with the tenant bound, after the change that may have ended eligibility.
    """
    if user_id is None:
        return
    guardian = _person_of(Guardian, user_id)
    student = None if guardian else _person_of(Student, user_id)
    if guardian is not None:
        if guardian.deleted_at is None and guardian_is_eligible(guardian):
            return
        tenant_id, kind = guardian.tenant_id, InvitationKind.GUARDIAN
    elif student is not None:
        if student_is_eligible(student):
            return
        tenant_id, kind = student.tenant_id, InvitationKind.STUDENT
    else:
        return

    if not is_portal_account(user_id, kind=kind):
        logger.warning(
            "portal sync skipped user %s: linked to staff or to another person, or holds a "
            "staff role",
            user_id,
        )
        return
    if not User.objects.filter(pk=user_id, tenant_id=tenant_id).exists():
        return

    # Invitations before the user row: the order `accept_invitation` locks them in.
    revoked = revoke_pending_invitations(user_id)
    user = User.objects.select_for_update().get(pk=user_id)
    was_active = user.is_active
    if was_active:
        user.is_active = False
        user.save(update_fields=["is_active", "updated_at"])
    revoke_refresh_tokens(user.pk)
    if was_active or revoked:
        record_task_security_event(
            DEACTIVATED_EVENT,
            tenant_id=tenant_id,
            actor_id=actor_id,
            resource_id=user.pk,
            kind=kind,
            revoked_invitations=revoked,
        )


def sync_student_portal_accounts(
    *, student_id: uuid.UUID, actor_id: uuid.UUID | None = None
) -> None:
    """Re-check the student's own account and every linked guardian's after a change.

    For withdrawal, outgoing transfer, graduation and deletion: the student loses
    eligibility, and a guardian whose only portal-enabled child this was does too.
    """
    student_user = Student.objects.filter(pk=student_id).values_list("user_id", flat=True)
    guardian_users = (
        StudentGuardian.objects.alive()
        .filter(student_id=student_id, guardian__user_id__isnull=False)
        .values_list("guardian__user_id", flat=True)
    )
    for user_id in {*student_user, *guardian_users}:
        sync_portal_account(user_id, actor_id=actor_id)


# ---------------------------------------------------------------------------
# Status
# ---------------------------------------------------------------------------


def with_portal_status(queryset: QuerySet) -> QuerySet:
    """Annotate ``portal_status`` on a guardian or student queryset in the same query.

    Read from the linked user and that user's latest invitation (by ``created_at``),
    mirroring ``Invitation.status``'s precedence, so a list costs no query per row.
    """
    latest = Invitation.objects.filter(user_id=OuterRef("user_id")).order_by("-created_at")

    def latest_field(name: str) -> Subquery:
        return Subquery(latest.values(name)[:1])

    return queryset.alias(
        portal_user_active=Subquery(
            User.objects.filter(pk=OuterRef("user_id")).values("is_active")[:1]
        ),
        portal_invitation_id=latest_field("pk"),
        portal_accepted_at=latest_field("accepted_at"),
        portal_revoked_at=latest_field("revoked_at"),
        portal_send_failed_at=latest_field("send_failed_at"),
        portal_expires_at=latest_field("expires_at"),
    ).annotate(
        portal_status=Case(
            When(user_id__isnull=True, then=Value(PortalStatus.NONE)),
            When(portal_user_active=True, then=Value(PortalStatus.ACTIVE)),
            When(portal_invitation_id__isnull=True, then=Value(PortalStatus.INACTIVE)),
            When(portal_accepted_at__isnull=False, then=Value(PortalStatus.INACTIVE)),
            When(portal_revoked_at__isnull=False, then=Value(PortalStatus.INACTIVE)),
            When(portal_send_failed_at__isnull=False, then=Value(PortalStatus.SEND_FAILED)),
            When(portal_expires_at__lte=Now(), then=Value(PortalStatus.EXPIRED)),
            default=Value(PortalStatus.INVITED),
            output_field=CharField(),
        )
    )


def portal_status_of(person: Guardian | Student) -> str:
    """One row's ``portal_status``, through the same expression the lists annotate."""
    status = (
        with_portal_status(type(person).objects.filter(pk=person.pk))
        .values_list("portal_status", flat=True)
        .first()
    )
    return status or PortalStatus.NONE
