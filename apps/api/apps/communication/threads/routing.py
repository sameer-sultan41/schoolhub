"""Who a thread can be addressed to — guardian routing and the staff recipient pool.

A guardian does not pick a staff member: §7 routes their thread to the class
teacher of the child's active section, and when there is none, to whoever holds
the tenant's configured fallback role (parent-portal §7's "configured role").
Staff picking colleagues for an internal or group thread draw from the same
pool, `thread_staff_users`, so "who counts as staff" has one definition here.
"""

from __future__ import annotations

import logging
import uuid

from django.db.models import OuterRef, Q, QuerySet, Subquery

from apps.student_management.models import Student
from apps.student_management.services import active_enrollment
from core.api.exceptions import DomainRuleViolation

logger = logging.getLogger(__name__)

# The role a guardian thread falls back to when the child has no class teacher
# and `TenantSettings.communication["thread_fallback_role"]` is unset or unknown.
THREAD_FALLBACK_ROLE_DEFAULT = "school_admin"

# The recipient lookup is a type-ahead, not a directory: a capped page is all a
# picker shows, and narrowing is what `search` is for.
RECIPIENTS_LIMIT = 20


def thread_staff_users(*, tenant_id: uuid.UUID) -> QuerySet:
    """Active users of this tenant holding a staff role and no restricted one.

    The restricted-role exclusion reads the same rows `is_restricted_principal`
    does (no `deleted_at` filter), so this pool and the permission class can
    never disagree about who is a guardian or student.
    """
    from core.rbac.models import User, UserRole

    staff_role_holders = UserRole.objects.filter(
        deleted_at__isnull=True,
        role__deleted_at__isnull=True,
        role__is_restricted_principal=False,
    ).values("user_id")
    restricted_role_holders = UserRole.objects.filter(role__is_restricted_principal=True).values(
        "user_id"
    )
    return (
        User.objects.filter(tenant_id=tenant_id, is_active=True, deleted_at__isnull=True)
        .filter(pk__in=staff_role_holders)
        .exclude(pk__in=restricted_role_holders)
    )


def route_guardian_thread(
    *, student: Student, tenant_id: uuid.UUID
) -> tuple[list[uuid.UUID], uuid.UUID | None]:
    """`(staff_user_ids, assigned_to)` for a guardian's thread about ``student``.

    The class teacher is assigned the thread; a fallback-role group is not, since
    no one of them owns it until someone replies.
    """
    class_teacher = _class_teacher_user_id(student=student, tenant_id=tenant_id)
    if class_teacher is not None:
        return [class_teacher], class_teacher

    role_slug = _fallback_role(tenant_id=tenant_id)
    user_ids = list(
        thread_staff_users(tenant_id=tenant_id)
        .filter(
            user_roles__deleted_at__isnull=True,
            user_roles__role__deleted_at__isnull=True,
            user_roles__role__slug=role_slug,
        )
        .distinct()
        .order_by("pk")
        .values_list("pk", flat=True)
    )
    if not user_ids:
        raise DomainRuleViolation("No staff member can receive this thread.")
    return user_ids, None


def search_recipients(*, tenant_id: uuid.UUID, exclude_user_id: uuid.UUID, search: str = ""):
    """Staff a caller can add to an internal or group thread, as `{user_id, name, role}` rows.

    `role` is one live staff role's name per user (alphabetically first), read
    by a correlated subquery so the lookup stays a single query.
    """
    from core.rbac.models import UserRole

    role_name = (
        UserRole.objects.filter(
            user_id=OuterRef("pk"),
            deleted_at__isnull=True,
            role__deleted_at__isnull=True,
            role__is_restricted_principal=False,
        )
        .order_by("role__name")
        .values("role__name")[:1]
    )
    queryset = thread_staff_users(tenant_id=tenant_id).exclude(pk=exclude_user_id)
    search = search.strip()
    if search:
        queryset = queryset.filter(
            Q(first_name__icontains=search)
            | Q(last_name__icontains=search)
            | Q(email__icontains=search)
        )
    return queryset.annotate(role_name=Subquery(role_name)).order_by(
        "first_name", "last_name", "pk"
    )[:RECIPIENTS_LIMIT]


def _class_teacher_user_id(*, student: Student, tenant_id: uuid.UUID) -> uuid.UUID | None:
    """The active section's class teacher, if they are an active staff user.

    `Section.class_teacher_staff_id` and `Staff.user_id` are plain UUID columns,
    not foreign keys, so a departed teacher or a deactivated account is checked
    here rather than falling out of a join.
    """
    from apps.staff_management.models import EmploymentStatus, Staff

    enrollment = active_enrollment(student)
    staff_id = enrollment.section.class_teacher_staff_id if enrollment else None
    if staff_id is None:
        return None
    user_id = (
        Staff.objects.alive()
        .filter(pk=staff_id, employment_status=EmploymentStatus.ACTIVE, user_id__isnull=False)
        .values_list("user_id", flat=True)
        .first()
    )
    if user_id is None:
        return None
    if not thread_staff_users(tenant_id=tenant_id).filter(pk=user_id).exists():
        return None
    return user_id


def _fallback_role(*, tenant_id: uuid.UUID) -> str:
    """The configured fallback role slug, or the default when it names no staff role.

    A typo or a deleted custom role must not leave guardians unable to write in,
    so an unknown slug degrades to the default with a warning rather than a 422.
    A restricted-principal role counts as unknown: routing a guardian's thread to
    every guardian would be a leak, not a fallback.
    """
    from core.rbac.models import Role
    from core.tenancy.models import TenantSettings

    settings = TenantSettings.objects.filter(tenant_id=tenant_id).first()
    communication = (settings.communication if settings else None) or {}
    configured = communication.get("thread_fallback_role")
    if not configured:
        return THREAD_FALLBACK_ROLE_DEFAULT

    slug = str(configured).strip()
    is_staff_role = Role.objects.filter(
        Q(tenant_id=tenant_id) | Q(tenant__isnull=True),
        slug=slug,
        deleted_at__isnull=True,
        is_restricted_principal=False,
    ).exists()
    if not is_staff_role:
        logger.warning(
            "thread_fallback_role %r is not a staff role for tenant %s; using %r.",
            slug,
            tenant_id,
            THREAD_FALLBACK_ROLE_DEFAULT,
        )
        return THREAD_FALLBACK_ROLE_DEFAULT
    return slug
