"""Models for the communication module.

Behaviour: docs/03-modules/communication.md. Column-level specs:
docs/05-database/entities/communication.md.

Two of the eight tables that doc lists — `notifications` and `delivery_logs` —
are **not** here. `core/notifications/models.py`'s own docstring states the
ownership split in full: those two tables, the channel adapters, the platform
default templates and `notify()` all live in `core/notifications/`, because
attendance (Tier 2) needed them long before this module (Tier 4) shipped. This
file owns the six tables that are genuinely tenant-configurable surface:
`notification_templates` (tenant overrides — `NotificationTemplateOverride`
below), `notification_preferences`, announcements, notices, message threads and
messages. `NotificationChannel`/`NotificationCategory` are imported from
`core.notifications.models`, never redeclared, so a tenant override and a
platform default can never disagree about what a valid channel or category is.

Nullable string columns below are NULL-not-blank by design — see
school_organization/models.py's header for why — hence the blanket DJ001
suppression.
"""
# ruff: noqa: DJ001

from __future__ import annotations

from django.db import models
from django.utils import timezone

from core.notifications.models import NotificationCategory, NotificationChannel
from core.tenancy.models import AppendOnlyTenantModel, TenantOwnedModel


class AudienceType(models.TextChoices):
    """Shared by `Announcement` and `Notice` — entities/communication.md's
    `audience_type` enum, identical on both tables."""

    ALL = "all", "All"
    STAFF = "staff", "Staff"
    STUDENTS = "students", "Students"
    GUARDIANS = "guardians", "Guardians"
    CLASS = "class", "Class"
    SECTION = "section", "Section"
    CUSTOM = "custom", "Custom"


class NotificationTemplateOverride(TenantOwnedModel):
    """A tenant's own wording for one (code, channel, locale) render target.

    `variables` is copied from the platform template's declared set at creation
    time and re-validated on every edit
    (`template_overrides.services.validate.assert_override_is_valid`) — never
    author-editable itself, since widening it would let a tenant declare a
    placeholder the platform template's context never supplies.

    `is_system` rows are seeded at tenant provisioning for every platform
    default so a tenant sees something to edit rather than a blank list; body
    and subject are editable, `code`/`channel` are locked
    (`template_overrides.serializers.NotificationTemplateOverrideSerializer.validate`),
    the same `is_system` split `fees_finance.LedgerAccount` already uses.
    """

    code = models.CharField(
        max_length=100, help_text="Matches a core.notifications trigger's template_code."
    )
    name = models.CharField(max_length=150)
    channel = models.CharField(max_length=10, choices=NotificationChannel.choices)
    locale = models.CharField(
        max_length=10,
        default="en",
        help_text="BCP-47 tag. Only 'en' is ever created in this plan — see the "
        "module's §20 register for the deferred locale-variant work.",
    )
    subject = models.CharField(
        max_length=200, null=True, blank=True, help_text="NULL for a subjectless channel (SMS)."
    )
    body = models.TextField()
    variables = models.JSONField(help_text="Copied from the platform template at creation.")
    is_system = models.BooleanField(default=False)
    is_active = models.BooleanField(
        default=True, help_text="Inactive falls back to the platform default, not to nothing."
    )

    class Meta:
        db_table = "notification_templates"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "code", "channel", "locale"],
                condition=models.Q(deleted_at__isnull=True),
                name="notification_templates_unique_live",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "code", "channel"], name="notif_tmpl_lookup_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.code} ({self.channel}, {self.locale})"


class NotificationPreference(TenantOwnedModel):
    """One user's opt-in for one (event_category, channel) pair.

    A missing row means "enabled" — `preferences.services.resolver.bulk_is_channel_enabled`
    treats the absence of a row as the default rather than requiring every user to be
    seeded with a full matrix, matching `notify()`'s own "until preferences
    exist, every trigger delivers at the mandatory floor" framing, generalized.
    """

    user_id = models.UUIDField(help_text="users(id) — tenant-checked at write time.")
    event_category = models.CharField(max_length=30, choices=NotificationCategory.choices)
    channel = models.CharField(max_length=10, choices=NotificationChannel.choices)
    is_enabled = models.BooleanField(default=True)

    class Meta:
        db_table = "notification_preferences"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "user_id", "event_category", "channel"],
                condition=models.Q(deleted_at__isnull=True),
                name="notification_preferences_unique_live",
            ),
        ]

    def __str__(self) -> str:
        return f"{self.user_id}:{self.event_category}:{self.channel}"

    @staticmethod
    def filter_owned_by_user(queryset, user):
        return queryset.filter(user_id=user.pk)


class AnnouncementStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    SCHEDULED = "scheduled", "Scheduled"
    PUBLISHED = "published", "Published"
    ARCHIVED = "archived", "Archived"


class Announcement(TenantOwnedModel):
    """Feed-style post with audience targeting and a draft/schedule/publish lifecycle.

    `audience_type`/`audience_filter` are resolved to recipient user ids by
    `audience.resolve_audience` at publish time, never stored resolved — the
    audience a school-wide announcement reaches must reflect who is enrolled
    *now*, not who was enrolled when it was drafted.
    """

    title = models.CharField(max_length=200)
    body = models.TextField(help_text="Rich text (sanitized HTML/Markdown).")
    audience_type = models.CharField(
        max_length=20, choices=AudienceType.choices, default=AudienceType.ALL
    )
    audience_filter = models.JSONField(
        null=True,
        blank=True,
        help_text="Role slugs / class, section, house, campus ids / user ids for 'custom'.",
    )
    campus_id = models.UUIDField(
        null=True, blank=True, help_text="campuses(id); NULL means all campuses."
    )
    status = models.CharField(
        max_length=20, choices=AnnouncementStatus.choices, default=AnnouncementStatus.DRAFT
    )
    is_emergency = models.BooleanField(
        default=False, help_text="Emergency posts bypass preferences on fan-out."
    )
    publish_at = models.DateTimeField(null=True, blank=True)
    expires_at = models.DateTimeField(
        null=True, blank=True, help_text="Hidden from feeds after expiry."
    )
    show_on_website = models.BooleanField(default=False)
    attachments = models.JSONField(null=True, blank=True, help_text="Array of files.id.")
    published_by = models.UUIDField(null=True, blank=True, help_text="users(id).")
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "announcements"
        indexes = [
            models.Index(
                fields=["tenant", "status", "publish_at"], name="announcements_status_idx"
            ),
            models.Index(fields=["tenant", "campus_id"], name="announcements_campus_idx"),
            models.Index(
                fields=["tenant", "show_on_website"],
                name="announcements_website_idx",
                condition=models.Q(show_on_website=True),
            ),
        ]

    def __str__(self) -> str:
        return self.title


class NoticeType(models.TextChoices):
    GENERAL = "general", "General"
    CIRCULAR = "circular", "Circular"
    EVENT = "event", "Event"
    URGENT = "urgent", "Urgent"


class NoticeStatus(models.TextChoices):
    DRAFT = "draft", "Draft"
    PENDING_APPROVAL = "pending_approval", "Pending approval"
    PUBLISHED = "published", "Published"
    ARCHIVED = "archived", "Archived"


class Notice(TenantOwnedModel):
    """Formal, per-tenant-numbered notice with publish approval and optional
    acknowledgment tracking.

    No `campus_id` column — a notice is tenant-wide by design (§15's schema
    does not give it one), so `scope_campus_field = None` on the viewset rather
    than the default `campus_id`, which does not exist on this table.
    """

    notice_no = models.CharField(
        max_length=50,
        null=True,
        blank=True,
        help_text="Assigned at publish from the tenant sequence.",
    )
    title = models.CharField(max_length=200)
    body = models.TextField()
    notice_type = models.CharField(
        max_length=20, choices=NoticeType.choices, default=NoticeType.GENERAL
    )
    audience_type = models.CharField(
        max_length=20, choices=AudienceType.choices, default=AudienceType.ALL
    )
    audience_filter = models.JSONField(null=True, blank=True)
    status = models.CharField(
        max_length=20, choices=NoticeStatus.choices, default=NoticeStatus.DRAFT
    )
    requires_acknowledgment = models.BooleanField(default=False)
    publish_at = models.DateTimeField(null=True, blank=True)
    valid_until = models.DateField(null=True, blank=True)
    show_on_website = models.BooleanField(default=False)
    attachments = models.JSONField(null=True, blank=True)
    approved_by = models.UUIDField(
        null=True, blank=True, help_text="users(id); must differ from created_by."
    )
    published_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notices"
        constraints = [
            models.UniqueConstraint(
                fields=["tenant", "notice_no"],
                condition=models.Q(deleted_at__isnull=True, notice_no__isnull=False),
                name="notices_unique_notice_no_live",
            ),
            # Segregation of duties, as far as a CHECK carries it — mirrors
            # `fees_finance.Expense`'s identical `..._approver_is_not_the_submitter`
            # constraint. `notices.services.publish.publish_notice` already enforces
            # this; this is
            # defense in depth against a direct write or a future code path that
            # forgets the check.
            models.CheckConstraint(
                condition=(
                    models.Q(approved_by__isnull=True)
                    | ~models.Q(approved_by=models.F("created_by"))
                ),
                name="notices_approver_not_drafter",
            ),
        ]
        indexes = [
            models.Index(fields=["tenant", "status", "publish_at"], name="notices_status_idx"),
        ]

    def __str__(self) -> str:
        return self.notice_no or self.title

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own` for a notice means "I am a recipient" — a
        `guardian`/`student` holding `communication.notice.acknowledge` has no
        other relationship to a `Notice` row to filter on. Without this hook,
        `scope_queryset`'s `RecordScope.OWN` branch falls through to its
        `own_field` fallback (`NoticeViewSet` sets none) straight to
        `queryset.none()` — the same query `acknowledge_notice` itself runs to
        find the recipient's own delivery row.
        """
        from core.notifications.models import Notification

        notice_ids = Notification.objects.filter(
            tenant_id=user.tenant_id, user_id=user.pk, source_type="notice"
        ).values_list("source_id", flat=True)
        return queryset.filter(pk__in=notice_ids)


class ThreadType(models.TextChoices):
    GUARDIAN_SCHOOL = "guardian_school", "Guardian-school"
    INTERNAL = "internal", "Internal"
    GROUP = "group", "Group"


class ThreadStatus(models.TextChoices):
    OPEN = "open", "Open"
    CLOSED = "closed", "Closed"


class MessageThread(TenantOwnedModel):
    """A conversation container: guardian-school, internal staff, or group.

    `participant_user_ids` is a JSON array of user-id strings rather than a join
    table (entities/communication.md; the join-table promotion is the module
    doc's §19 recommendation). The GIN index (see `Meta`) is what keeps "threads I am
    in" a lookup. Because it is not a foreign key, `participant_filter` is the
    single place that reads it — never filter on the column elsewhere.

    `last_message_at` is NOT NULL, tighter than the entity doc's nullable column:
    a thread is created together with its first message, so there is no state a
    NULL would describe, and the inbox sort (`status`, `last_message_at DESC`)
    never has to place a NULL.
    """

    subject = models.CharField(max_length=200)
    thread_type = models.CharField(
        max_length=20, choices=ThreadType.choices, default=ThreadType.GUARDIAN_SCHOOL
    )
    student = models.ForeignKey(
        "student_management.Student",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="message_threads",
        help_text="Child context for a guardian thread.",
    )
    participant_user_ids = models.JSONField(
        default=list, help_text="Array of users(id) strings; read through participant_filter."
    )
    assigned_to_id = models.UUIDField(
        null=True, blank=True, help_text="users(id); staff member currently responsible."
    )
    status = models.CharField(
        max_length=10, choices=ThreadStatus.choices, default=ThreadStatus.OPEN
    )
    last_message_at = models.DateTimeField(
        default=timezone.now, help_text="Denormalized for inbox sorting."
    )
    closed_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "message_threads"
        indexes = [
            models.Index(
                fields=["tenant", "status", "-last_message_at"], name="message_threads_inbox_idx"
            ),
            models.Index(fields=["tenant", "student"], name="message_threads_student_idx"),
        ]
        # The GIN index on `participant_user_ids` (msg_threads_participants_idx) is
        # created by `RunSQL` in migration 0006, not declared here: `GinIndex` needs
        # `django.contrib.postgres` in INSTALLED_APPS, which registers type handlers
        # on every connection — the same reason student_management declined a GIN
        # index on `custom_fields`. Revisit if a second GIN index appears.

    def __str__(self) -> str:
        return self.subject

    @classmethod
    def participant_filter(cls, queryset, user):
        """Threads `user` is a participant of — JSON containment, served by the GIN index."""
        return queryset.filter(participant_user_ids__contains=[str(user.pk)])

    @classmethod
    def filter_owned_by_user(cls, queryset, user):
        """Record scope `own`: a thread the user takes part in."""
        return cls.participant_filter(queryset, user)

    @classmethod
    def filter_assigned_to_user(cls, queryset, user):
        """Record scope `assigned`: a thread routed to the user is one they are a participant of."""
        return cls.participant_filter(queryset, user)

    def is_participant(self, user_id) -> bool:
        return str(user_id) in self.participant_user_ids


class Message(AppendOnlyTenantModel):
    """One post in a thread. Immutable once sent, bar the `read_by` receipt map.

    No `updated_*` columns (the entity doc: "edits disallowed") and no soft
    delete, which the entity doc lists but an append-only table cannot carry —
    soft delete is an UPDATE (`AppendOnlyTenantModel`). Recorded in
    docs/deferred-work.md.

    `MUTABLE_FIELDS` must stay in step with `append_only_operations(
    mutable_columns=...)` in migration 0007; `tests/test_append_only_coverage.py`
    asserts that.
    """

    MUTABLE_FIELDS = frozenset({"read_by"})

    thread = models.ForeignKey(MessageThread, on_delete=models.PROTECT, related_name="messages")
    sender_id = models.UUIDField(help_text="users(id); must be a thread participant.")
    body = models.TextField()
    attachments = models.JSONField(null=True, blank=True, help_text="Array of files.id.")
    is_internal_note = models.BooleanField(
        default=False, help_text="Staff-only: hidden from guardians and students."
    )
    read_by = models.JSONField(
        null=True, blank=True, help_text="Map users(id) -> read timestamp (ISO 8601)."
    )
    sent_at = models.DateTimeField(default=timezone.now)

    class Meta:
        db_table = "messages"
        indexes = [
            models.Index(fields=["tenant", "thread", "sent_at"], name="messages_thread_sent_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.thread_id}:{self.sent_at:%Y-%m-%d %H:%M}"
