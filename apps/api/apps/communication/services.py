"""Business rules for the communication module. Views and tasks call this, never models directly."""

from __future__ import annotations

import uuid

from django.core.cache import cache
from django.utils import timezone

from apps.communication.models import AudienceType
from core.api.exceptions import DomainRuleViolation
from core.notifications.models import NotificationCategory, NotificationChannel
from core.notifications.templates import SUBJECTLESS_CHANNELS, used_placeholders
from core.notifications.templates import registry as platform_templates
from core.tenancy.features import is_feature_enabled

FEATURE = "module.communication"

_PREFERENCE_CACHE_TTL = 300


def assert_override_is_valid(*, code: str, channel: str, subject: str | None, body: str) -> None:
    """A tenant override may only reference variables the platform template declared,
    and must match its channel's subject shape.

    Reuses `core.notifications.templates.used_placeholders` — the same
    extraction `_assert_placeholders_declared` runs at registration — because an
    editor's proposed text is checked against a *different* template's (the
    platform default's) declared set, so that function's own check (which reads
    a `NotificationTemplate` instance's own `.variables`) does not apply as-is.
    Refuses if the platform itself has no such (code, channel) at all: an
    override cannot exist for a trigger nothing declares.

    The subject-shape check mirrors `TemplateRegistry.register()`'s own two
    directions for a platform template: SMS/WhatsApp have no title concept and
    must not carry one, and every other channel must. Without this a tenant
    could save an EMAIL/IN_APP override with an empty subject — a notification
    with no title — or an SMS override whose subject silently never renders.
    """
    platform = platform_templates.get(code, channel)
    if platform is None:
        raise DomainRuleViolation(
            f"No platform template exists for ({code!r}, {channel!r}) to override.",
            meta={"code": code, "channel": channel},
        )

    if channel in SUBJECTLESS_CHANNELS and subject:
        raise DomainRuleViolation(
            f"Channel {channel!r} has no subject; this override set one.",
            meta={"channel": channel},
        )
    if channel not in SUBJECTLESS_CHANNELS and not subject:
        raise DomainRuleViolation(
            f"Channel {channel!r} needs a subject.", meta={"channel": channel}
        )

    used = used_placeholders(subject or "", body)
    undeclared = used - platform.variables
    if undeclared:
        raise DomainRuleViolation(
            f"This template uses variables the platform template does not declare: "
            f"{', '.join(sorted(undeclared))}.",
            meta={"undeclared_variables": sorted(undeclared)},
        )


def assert_preference_may_be_saved(*, event_category: str, is_enabled: bool) -> None:
    """§11: the emergency category cannot be disabled — the mandatory floor.

    `core.notifications.services`'s own resolver-call site also refuses to even
    ask for emergency, so this is defense in depth against the row existing at
    all with the wrong value, not the only thing standing between a user and it.
    """
    if event_category == NotificationCategory.EMERGENCY and not is_enabled:
        raise DomainRuleViolation(
            "The emergency notification category cannot be disabled.",
            meta={"event_category": event_category},
        )


def bulk_is_channel_enabled(
    user_ids: list[uuid.UUID], event_category: str, channel: str, tenant_id: uuid.UUID
) -> dict[uuid.UUID, bool]:
    """Registered as `core.notifications.services`'s preference resolver.

    Batch-shaped — one call per (channel, fan-out), not one per (recipient,
    channel): a per-item resolver was tried first and reverted, because
    `_delivery_for` calls it once per row in `notify()`'s bulk-insert
    comprehension, which reintroduced exactly the round-trip-per-recipient cost
    `resolve_addresses` already avoids for email. Per-user cache is checked
    first (`cache.get_many`), so a recipient whose matrix was already cached
    from an earlier `notify()` call costs nothing here; only the misses reach
    the table, in one query for the whole set. A missing key in the returned
    map means enabled — see `NotificationPreference`'s docstring for why "no
    row" must not mean "ask again every time".
    """
    if not is_feature_enabled(FEATURE, tenant_id=tenant_id):
        return {}

    from apps.communication.models import NotificationPreference

    cache_keys = {user_id: f"notif-pref:{tenant_id}:{user_id}" for user_id in user_ids}
    cached = cache.get_many(cache_keys.values())

    result: dict[uuid.UUID, bool] = {}
    missing: list[uuid.UUID] = []
    for user_id in user_ids:
        matrix = cached.get(cache_keys[user_id])
        if matrix is None:
            missing.append(user_id)
        else:
            result[user_id] = matrix.get((event_category, channel), True)

    if missing:
        rows = NotificationPreference.objects.filter(
            tenant_id=tenant_id, user_id__in=missing
        ).values_list("user_id", "event_category", "channel", "is_enabled")
        by_user: dict[uuid.UUID, dict[tuple[str, str], bool]] = {user_id: {} for user_id in missing}
        for user_id, category, ch, is_enabled in rows:
            by_user[user_id][(category, ch)] = is_enabled
        cache.set_many(
            {cache_keys[user_id]: matrix for user_id, matrix in by_user.items()},
            _PREFERENCE_CACHE_TTL,
        )
        for user_id, matrix in by_user.items():
            result[user_id] = matrix.get((event_category, channel), True)

    return result


def _preference_matrix(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> dict[tuple[str, str], bool]:
    """The single-user path, for `materialize_preference_matrix`/`GET
    /notification-preferences` — a viewer's own settings page, not a fan-out, so
    the batch shape `bulk_is_channel_enabled` needs would only add complexity here.
    """
    if not is_feature_enabled(FEATURE, tenant_id=tenant_id):
        return {}

    from apps.communication.models import NotificationPreference

    cache_key = f"notif-pref:{tenant_id}:{user_id}"
    cached = cache.get(cache_key)
    if cached is not None:
        return cached

    rows = NotificationPreference.objects.filter(tenant_id=tenant_id, user_id=user_id).values_list(
        "event_category", "channel", "is_enabled"
    )
    matrix = {(category, channel): is_enabled for category, channel, is_enabled in rows}
    cache.set(cache_key, matrix, _PREFERENCE_CACHE_TTL)
    return matrix


def evict_preference_cache(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> None:
    cache.delete(f"notif-pref:{tenant_id}:{user_id}")


def materialize_preference_matrix(*, user_id: uuid.UUID, tenant_id: uuid.UUID) -> list[dict]:
    """Every (category, channel) pair, stored rows overlaid on the `True` default.

    `GET /notification-preferences` returns this rather than the bare stored
    rows, so a client never has to know "no row" means enabled — the same
    completeness `bulk_is_channel_enabled`'s own docstring argues for, now for
    the read side instead of the delivery-gating side.
    """
    matrix = _preference_matrix(user_id=user_id, tenant_id=tenant_id)
    return [
        {
            "event_category": category,
            "channel": channel,
            "is_enabled": matrix.get((category, channel), True),
        }
        for category in NotificationCategory.values
        for channel in NotificationChannel.values
    ]


def save_preferences(*, user_id: uuid.UUID, tenant_id: uuid.UUID, rows: list[dict]) -> None:
    """Upsert each `{event_category, channel, is_enabled}` row for this user.

    Each row was already validated by `NotificationPreferenceUpdateSerializer`
    (which calls `assert_preference_may_be_saved`), so this is pure persistence —
    the `post_save` signal (`signals.py`) evicts the cache, which is why no
    eviction call appears here.
    """
    from apps.communication.models import NotificationPreference

    for row in rows:
        NotificationPreference.objects.update_or_create(
            tenant_id=tenant_id,
            user_id=user_id,
            event_category=row["event_category"],
            channel=row["channel"],
            defaults={"is_enabled": row["is_enabled"]},
        )


# ---------------------------------------------------------------------------
# Audience resolution — shared by announcements and notices.
# ---------------------------------------------------------------------------


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


# ---------------------------------------------------------------------------
# Announcements.
# ---------------------------------------------------------------------------


def publish_announcement(announcement, *, actor_id: uuid.UUID):
    """Draft/scheduled -> published: resolves the audience, fans out once.

    §12 fires on the transition, not on current status, so a retry after a
    partial failure never re-notifies an already-published announcement — the
    `status` check below is what makes this safe to call twice.
    """
    from apps.communication.models import Announcement, AnnouncementStatus
    from core.notifications.services import Recipient, notify

    locked = Announcement.objects.select_for_update().get(pk=announcement.pk)
    if locked.status == AnnouncementStatus.PUBLISHED:
        raise DomainRuleViolation({"status": "This announcement is already published."})

    recipients = resolve_audience(
        audience_type=locked.audience_type,
        audience_filter=locked.audience_filter,
        tenant_id=locked.tenant_id,
        campus_id=locked.campus_id,
    )
    assert_audience_is_nonempty(recipients)

    now = timezone.now()
    locked.status = AnnouncementStatus.PUBLISHED
    locked.published_by = actor_id
    locked.published_at = now
    locked.updated_by = actor_id
    locked.save(
        update_fields=["status", "published_by", "published_at", "updated_by", "updated_at"]
    )

    # One notify() call for the whole resolved audience — never per-recipient.
    # The fees-finance review caught exactly this anti-pattern once already
    # this session; §5 explicitly expects one announcement to reach thousands.
    notify(
        "communication.announcement-published",
        tenant_id=locked.tenant_id,
        recipients=[Recipient(user_id=uid) for uid in recipients],
        context={"announcement.title": locked.title, "announcement.body": locked.body},
        source_type="announcement",
        source_id=locked.pk,
    )
    return locked


# ---------------------------------------------------------------------------
# Notices.
# ---------------------------------------------------------------------------


def submit_notice(notice, *, actor_id: uuid.UUID):
    """draft -> pending_approval."""
    from apps.communication.models import Notice, NoticeStatus

    locked = Notice.objects.select_for_update().get(pk=notice.pk)
    if locked.status != NoticeStatus.DRAFT:
        raise DomainRuleViolation(
            {"status": f"Only a draft notice can be submitted (this one is {locked.status})."}
        )
    locked.status = NoticeStatus.PENDING_APPROVAL
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "updated_by", "updated_at"])
    return locked


def return_notice_to_draft(notice, *, actor_id: uuid.UUID):
    """pending_approval -> draft, with comments. §7's workflow diagram: a
    returned notice goes back to draft, not to a third "rejected" state — the
    drafter edits and resubmits through the same `:submit` step."""
    from apps.communication.models import Notice, NoticeStatus

    locked = Notice.objects.select_for_update().get(pk=notice.pk)
    if locked.status != NoticeStatus.PENDING_APPROVAL:
        raise DomainRuleViolation(
            {"status": "Only a notice pending approval can be returned to draft."}
        )
    locked.status = NoticeStatus.DRAFT
    locked.updated_by = actor_id
    locked.save(update_fields=["status", "updated_by", "updated_at"])
    return locked


def publish_notice(notice, *, actor_id: uuid.UUID):
    """pending_approval -> published: allocates notice_no, resolves the
    audience, fans out once.

    The approver must differ from the drafter — auth-and-rbac.md §2.4,
    checked here so the rule holds regardless of which door a caller
    approves through, the same shape `fees_finance.decide_refund` uses.
    """
    from apps.communication import numbering
    from apps.communication.models import Notice, NoticeStatus
    from core.notifications.services import Recipient, notify

    locked = Notice.objects.select_for_update().get(pk=notice.pk)
    if locked.status != NoticeStatus.PENDING_APPROVAL:
        raise DomainRuleViolation(
            {"status": "A notice must be pending approval before it can be published."}
        )
    if locked.created_by == actor_id:
        raise DomainRuleViolation(
            {
                "approved_by": (
                    "The person who drafted a notice cannot approve it (auth-and-rbac §2.4)."
                )
            }
        )

    recipients = resolve_audience(
        audience_type=locked.audience_type,
        audience_filter=locked.audience_filter,
        tenant_id=locked.tenant_id,
    )
    assert_audience_is_nonempty(recipients)

    now = timezone.now()
    locked.notice_no = numbering.allocate_notice_no(tenant_id=locked.tenant_id, on_date=now.date())
    locked.status = NoticeStatus.PUBLISHED
    locked.approved_by = actor_id
    locked.published_at = now
    locked.updated_by = actor_id
    locked.save(
        update_fields=[
            "notice_no",
            "status",
            "approved_by",
            "published_at",
            "updated_by",
            "updated_at",
        ]
    )

    notify(
        "communication.notice-published",
        tenant_id=locked.tenant_id,
        recipients=[Recipient(user_id=uid) for uid in recipients],
        context={
            "notice.notice_no": locked.notice_no,
            "notice.title": locked.title,
            "notice.body": locked.body,
        },
        source_type="notice",
        source_id=locked.pk,
    )
    return locked


def acknowledge_notice(notice, *, actor_id: uuid.UUID) -> None:
    """Idempotent: a second acknowledgment from the same user is a no-op, not
    an error — a guardian double-tapping "acknowledge" must not 500.

    Tracked on the recipient's own `Notification.acknowledged_at` row (PR A's
    `core.notifications.Notification` already carries this column) rather than
    a new table — one row per (notice, recipient) already exists there from
    the publish fan-out.
    """
    from apps.communication.models import NoticeStatus

    if notice.status != NoticeStatus.PUBLISHED:
        raise DomainRuleViolation({"status": "Only a published notice can be acknowledged."})
    if not notice.requires_acknowledgment:
        raise DomainRuleViolation(
            {"requires_acknowledgment": "This notice does not require acknowledgment."}
        )

    from core.notifications.models import Notification

    Notification.objects.filter(
        tenant_id=notice.tenant_id,
        user_id=actor_id,
        source_type="notice",
        source_id=notice.pk,
        acknowledged_at__isnull=True,
    ).update(acknowledged_at=timezone.now())
