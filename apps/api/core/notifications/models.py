"""Notification storage — the delivery machinery, not the tenant-facing surface.

Column-level specs: docs/05-database/entities/communication.md (`notifications`,
`delivery_logs`). Behaviour: docs/02-architecture/notifications.md.

**Ownership.** The communication module doc (Tier 4) lists these two tables among
its owned entities, but `notifications.md` §1 puts the adapter interface in
`core/notifications/` and §10 draws the line explicitly: module docs supply the
trigger-catalog *content*, the architecture doc defines the *machinery*. Attendance
(Tier 2) needs the machinery long before communication ships, so the split is:

- **here** — `notifications`, `delivery_logs`, the channel adapters, the platform
  default templates, and the `notify()` entry point every module calls.
- **communication (Tier 4)** — announcements, notices, message threads, plus
  `notification_templates` (tenant overrides), `notification_preferences`, the
  delivery dashboard, and the SMS/push/WhatsApp adapters.

Nullable string columns below are NULL-not-blank by design — see
school_organization/models.py's header for why — hence the blanket DJ001 suppression.
"""
# ruff: noqa: DJ001

from __future__ import annotations

from django.db import models

from core.tenancy.models import TenantOwnedModel


class NotificationChannel(models.TextChoices):
    """notifications.md §1. Only IN_APP and EMAIL have a working adapter today."""

    EMAIL = "email", "Email"
    SMS = "sms", "SMS"
    PUSH = "push", "Push"
    IN_APP = "in_app", "In-app"
    WHATSAPP = "whatsapp", "WhatsApp"


class NotificationCategory(models.TextChoices):
    """Matches `notification_preferences.event_category` in the entity doc, so the
    preference matrix communication ships later joins to these values unchanged."""

    ATTENDANCE = "attendance", "Attendance"
    FEES = "fees", "Fees"
    EXAMS = "exams", "Exams"
    LIBRARY = "library", "Library"
    TRANSPORT = "transport", "Transport"
    ACADEMIC = "academic", "Academic"
    GENERAL = "general", "General"
    EMERGENCY = "emergency", "Emergency"


class NotificationPriority(models.TextChoices):
    NORMAL = "normal", "Normal"
    HIGH = "high", "High"
    EMERGENCY = "emergency", "Emergency"


class DeliveryStatus(models.TextChoices):
    """A subset of notifications.md §6's state machine.

    `deferred` and `suppressed` are absent deliberately: quiet hours, suppression
    lists and quotas are all communication-module scope, and a status no code can
    ever set would be indistinguishable from a bug (the same trap
    `core.files.FileStatus.QUARANTINED` is already documented as).
    """

    QUEUED = "queued", "Queued"
    SENT = "sent", "Sent"
    DELIVERED = "delivered", "Delivered"
    FAILED = "failed", "Failed"
    BOUNCED = "bounced", "Bounced"
    SKIPPED = "skipped", "Skipped"


class Notification(TenantOwnedModel):
    """One row per recipient, persisted before anything is enqueued.

    notifications.md §3.4: the database is the source of truth and queues are only
    transport, so a worker that dies has lost delivery attempts, never the record
    that a notification was owed.
    """

    user_id = models.UUIDField(help_text="users(id) — the recipient, tenant-checked at write time.")
    event_key = models.CharField(
        max_length=100, help_text="Producing event, e.g. 'attendance.student-absent'."
    )
    category = models.CharField(
        max_length=30, choices=NotificationCategory.choices, default=NotificationCategory.GENERAL
    )
    title = models.CharField(max_length=200, help_text="Rendered from the template.")
    body = models.TextField(help_text="Rendered from the template.")
    data = models.JSONField(
        null=True, blank=True, help_text="Deep-link payload (resource type/id, route)."
    )
    source_type = models.CharField(
        max_length=50, null=True, blank=True, help_text="Polymorphic origin, e.g. 'student'."
    )
    source_id = models.UUIDField(
        null=True, blank=True, help_text="Origin row id, validated in the service layer."
    )
    priority = models.CharField(
        max_length=10, choices=NotificationPriority.choices, default=NotificationPriority.NORMAL
    )
    read_at = models.DateTimeField(null=True, blank=True)
    acknowledged_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "notifications"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "user_id", "read_at", "-created_at"],
                name="notifications_inbox_idx",
            ),
            models.Index(
                fields=["tenant", "source_type", "source_id"], name="notifications_source_idx"
            ),
        ]

    def __str__(self) -> str:
        return f"{self.event_key} -> {self.user_id}"


class DeliveryLog(TenantOwnedModel):
    """One row per notification per channel attempt.

    The entity doc marks this a high-volume operational table with **no soft
    delete**: `deleted_at` is inherited but never set, and rows are removed by a
    retention job rather than tombstoned. Nothing here filters on `.alive()`.
    """

    notification = models.ForeignKey(
        Notification, on_delete=models.CASCADE, related_name="deliveries"
    )
    channel = models.CharField(max_length=10, choices=NotificationChannel.choices)
    template_code = models.CharField(
        max_length=100,
        null=True,
        blank=True,
        help_text="Template used at render time — a soft reference by code, so it "
        "survives the template being edited or removed.",
    )
    provider = models.CharField(
        max_length=50, null=True, blank=True, help_text="Adapter name, e.g. 'console', 'ses'."
    )
    provider_message_id = models.CharField(max_length=150, null=True, blank=True)
    recipient_address = models.CharField(
        max_length=255,
        help_text="Email/phone/device token, stored masked — see services.mask_address.",
    )
    status = models.CharField(
        max_length=15, choices=DeliveryStatus.choices, default=DeliveryStatus.QUEUED
    )
    attempts = models.PositiveSmallIntegerField(default=0)
    error_message = models.TextField(null=True, blank=True)
    last_attempt_at = models.DateTimeField(null=True, blank=True)
    delivered_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "delivery_logs"
        ordering = ["-created_at"]
        indexes = [
            models.Index(
                fields=["tenant", "status", "last_attempt_at"], name="delivery_logs_status_idx"
            ),
            models.Index(fields=["tenant", "notification"], name="delivery_logs_notif_idx"),
            models.Index(fields=["provider_message_id"], name="delivery_logs_provider_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.channel}:{self.status}"
