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

from core.notifications.models import NotificationCategory, NotificationChannel
from core.tenancy.models import TenantOwnedModel


class NotificationTemplateOverride(TenantOwnedModel):
    """A tenant's own wording for one (code, channel, locale) render target.

    `variables` is copied from the platform template's declared set at creation
    time and re-validated on every edit (`services.assert_override_is_valid`) —
    never author-editable itself, since widening it would let a tenant declare a
    placeholder the platform template's context never supplies.

    `is_system` rows are seeded at tenant provisioning for every platform
    default so a tenant sees something to edit rather than a blank list; body
    and subject are editable, `code`/`channel` are locked (`services.py`), the
    same `is_system` split `fees_finance.LedgerAccount` already uses.
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

    A missing row means "enabled" — `services.is_channel_enabled` treats the
    absence of a row as the default rather than requiring every user to be
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
