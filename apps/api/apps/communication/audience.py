"""`(audience_type, audience_filter) -> [user_id, ...]` — the audience-
resolution engine shared by `announcements` and `notices`' publish actions.

Lives at the app level, not inside either resource package, because both
`apps.communication.announcements.services.publish.publish_announcement` and
`apps.communication.notices.services.publish.publish_notice` call it — the
one genuinely cross-resource piece of business logic in this module.
"""

from __future__ import annotations

import uuid

from apps.communication.models import AudienceType
from core.api.exceptions import DomainRuleViolation


def resolve_audience(
    *,
    audience_type: str,
    audience_filter: dict | None,
    tenant_id: uuid.UUID,
    campus_id: uuid.UUID | None = None,
) -> list[uuid.UUID]:
    """`(audience_type, audience_filter) -> [user_id, ...]`, one query per branch
    (`all`/`staff`/`students`/`guardians` — `all` becomes three bounded queries,
    not a per-recipient one, when `campus_id` narrows it; see `_resolve_all`).

    `class`/`section` resolve to the **guardians** of enrolled students, not the
    students themselves — matching the module doc's own worked example ("targets
    classes 6-10 guardians") and the real use case: a circular goes to parents.
    Both require a non-empty `class_ids`/`section_ids` respectively — omitting
    it is refused, not treated as "every guardian in the tenant".
    `students`/`guardians` resolve their whole tenant-wide population, narrowed
    by the same `audience_filter` keys (`class_ids`, `section_ids`, `house_ids`,
    `campus_ids`) when present. `staff` resolves every non-restricted-principal
    role holder, optionally narrowed by `audience_filter.role_slugs`. `custom`
    reads `audience_filter.user_ids` directly, `all` is every active user.

    `campus_id` — an announcement's own campus scope (`Announcement.campus_id`;
    `Notice` has none) — narrows every branch except `custom`: a caller's
    explicit, named recipient list is never silently narrowed by campus. It
    ANDs with, never overrides, whatever `audience_filter.campus_ids` already
    says.
    """
    audience_filter = audience_filter or {}

    if audience_type == AudienceType.ALL:
        return _resolve_all(tenant_id=tenant_id, campus_id=campus_id)
    if audience_type == AudienceType.STAFF:
        return _resolve_staff(
            tenant_id=tenant_id, audience_filter=audience_filter, campus_id=campus_id
        )
    if audience_type == AudienceType.STUDENTS:
        return _resolve_students(
            tenant_id=tenant_id, audience_filter=audience_filter, campus_id=campus_id
        )
    if audience_type == AudienceType.CLASS and not audience_filter.get("class_ids"):
        raise DomainRuleViolation(
            {"audience_filter": "audience_type 'class' requires a non-empty class_ids."}
        )
    if audience_type == AudienceType.SECTION and not audience_filter.get("section_ids"):
        raise DomainRuleViolation(
            {"audience_filter": "audience_type 'section' requires a non-empty section_ids."}
        )
    # CLASS/SECTION carry the same audience_filter shape as GUARDIANS (the
    # caller sets class_ids/section_ids either way) — they exist as their own
    # audience_type values only so a client can express "everyone in this
    # class" without also having to say "and I mean their guardians".
    if audience_type in (AudienceType.GUARDIANS, AudienceType.CLASS, AudienceType.SECTION):
        return _resolve_guardians(
            tenant_id=tenant_id, audience_filter=audience_filter, campus_id=campus_id
        )
    if audience_type == AudienceType.CUSTOM:
        return _resolve_custom(tenant_id=tenant_id, audience_filter=audience_filter)

    raise DomainRuleViolation(f"Unknown audience_type {audience_type!r}.")


def assert_audience_is_nonempty(recipients: list[uuid.UUID]) -> None:
    """§11: audience resolution must yield >= 1 recipient — a published
    announcement/notice with zero reach is refused, not silently sent to no one."""
    if not recipients:
        raise DomainRuleViolation(
            "This audience resolves to zero recipients. Broaden the targeting before publishing."
        )


def _resolve_all(*, tenant_id: uuid.UUID, campus_id: uuid.UUID | None = None) -> list[uuid.UUID]:
    from core.rbac.models import User

    if campus_id is None:
        return list(
            User.objects.filter(
                tenant_id=tenant_id, is_active=True, deleted_at__isnull=True
            ).values_list("id", flat=True)
        )

    # No single table expresses "every user associated with campus X" — staff
    # via `UserRole` scope, students/guardians via `Student.campus_id`. Union
    # the three bounded per-branch queries rather than inventing a fourth,
    # still no per-recipient query.
    campus_scoped: set[uuid.UUID] = set()
    campus_scoped.update(
        _resolve_staff(tenant_id=tenant_id, audience_filter={}, campus_id=campus_id)
    )
    campus_scoped.update(
        _resolve_students(tenant_id=tenant_id, audience_filter={}, campus_id=campus_id)
    )
    campus_scoped.update(
        _resolve_guardians(tenant_id=tenant_id, audience_filter={}, campus_id=campus_id)
    )
    return list(campus_scoped)


def _resolve_staff(
    *, tenant_id: uuid.UUID, audience_filter: dict, campus_id: uuid.UUID | None = None
) -> list[uuid.UUID]:
    from django.db.models import Q

    from core.rbac.models import RecordScope, User

    # A staff member holding an ALL-scope role is tenant-wide by definition and
    # stays included regardless of the announcement's campus — only a
    # CAMPUS-scoped role assignment can exclude them.
    campus_condition = Q()
    if campus_id is not None:
        campus_condition = Q(user_roles__scope=RecordScope.ALL) | Q(
            user_roles__scope=RecordScope.CAMPUS, user_roles__scope_ref=campus_id
        )

    qs = User.objects.filter(
        campus_condition,
        tenant_id=tenant_id,
        is_active=True,
        deleted_at__isnull=True,
        user_roles__deleted_at__isnull=True,
        user_roles__role__is_restricted_principal=False,
        user_roles__role__deleted_at__isnull=True,
    )
    role_slugs = audience_filter.get("role_slugs")
    if role_slugs:
        qs = qs.filter(user_roles__role__slug__in=role_slugs)
    return list(qs.distinct().values_list("id", flat=True))


def _resolve_students(
    *, tenant_id: uuid.UUID, audience_filter: dict, campus_id: uuid.UUID | None = None
) -> list[uuid.UUID]:
    from apps.student_management.models import Student
    from core.rbac.models import User

    # `Student.user_id` is a plain UUID column, not a FK to `User` — a deleted
    # or deactivated portal account leaves the student record untouched, so
    # this must be checked explicitly rather than falling out of a join.
    active_user_ids = User.objects.filter(
        tenant_id=tenant_id, is_active=True, deleted_at__isnull=True
    ).values_list("id", flat=True)
    qs = Student.objects.alive().filter(
        tenant_id=tenant_id, user_id__isnull=False, user_id__in=active_user_ids
    )
    qs = _narrow_students(qs, audience_filter, campus_id=campus_id)
    return list(qs.values_list("user_id", flat=True).distinct())


def _resolve_guardians(
    *, tenant_id: uuid.UUID, audience_filter: dict, campus_id: uuid.UUID | None = None
) -> list[uuid.UUID]:
    from apps.student_management.models import Student, StudentGuardian
    from core.rbac.models import User

    active_user_ids = User.objects.filter(
        tenant_id=tenant_id, is_active=True, deleted_at__isnull=True
    ).values_list("id", flat=True)
    students = _narrow_students(
        Student.objects.alive().filter(tenant_id=tenant_id), audience_filter, campus_id=campus_id
    )
    links = StudentGuardian.objects.alive().filter(
        student__in=students,
        has_portal_access=True,
        guardian__deleted_at__isnull=True,
        guardian__user_id__isnull=False,
        guardian__user_id__in=active_user_ids,
    )
    return list(links.values_list("guardian__user_id", flat=True).distinct())


def _narrow_students(queryset, audience_filter: dict, *, campus_id: uuid.UUID | None = None):
    """Applies class/section/house/campus narrowing to a `Student` queryset —
    shared by `_resolve_students` and `_resolve_guardians`, since `class`/
    `section` audience types are just guardians of a narrowed student set.

    `campus_id` (an announcement's own campus scope) ANDs with the caller's
    own `audience_filter.campus_ids`, never overrides it.
    """
    class_ids = audience_filter.get("class_ids")
    section_ids = audience_filter.get("section_ids")
    if class_ids or section_ids:
        from django.db.models import Q

        from apps.student_management.models import EnrollmentStatus, StudentEnrollment

        # OR, not AND: a student in either named class or named section counts,
        # matching "class 6 OR class 7" targeting rather than requiring both
        # narrowings to hold on the same enrollment row.
        condition = Q()
        if class_ids:
            condition |= Q(school_class_id__in=class_ids)
        if section_ids:
            condition |= Q(section_id__in=section_ids)
        enrolled_student_ids = (
            StudentEnrollment.objects.alive()
            .filter(condition, status=EnrollmentStatus.ACTIVE)
            .values_list("student_id", flat=True)
        )
        queryset = queryset.filter(pk__in=enrolled_student_ids)

    house_ids = audience_filter.get("house_ids")
    if house_ids:
        queryset = queryset.filter(house_id__in=house_ids)

    campus_ids = audience_filter.get("campus_ids")
    if campus_ids:
        queryset = queryset.filter(campus_id__in=campus_ids)

    if campus_id is not None:
        queryset = queryset.filter(campus_id=campus_id)

    return queryset


def _resolve_custom(*, tenant_id: uuid.UUID, audience_filter: dict) -> list[uuid.UUID]:
    from core.rbac.models import User

    requested = [uuid.UUID(str(uid)) for uid in audience_filter.get("user_ids") or []]
    if not requested:
        return []

    found = set(
        User.objects.filter(
            tenant_id=tenant_id, pk__in=requested, deleted_at__isnull=True
        ).values_list("id", flat=True)
    )
    missing = set(requested) - found
    if missing:
        raise DomainRuleViolation(
            f"user_ids {sorted(str(uid) for uid in missing)} do not belong to this tenant.",
            meta={"missing_user_ids": sorted(str(uid) for uid in missing)},
        )
    return list(found)
