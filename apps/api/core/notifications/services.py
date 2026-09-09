"""The entry point every module calls: `notify(event_key, ...)`.

Shape follows notifications.md §3.4 exactly — **persist first, enqueue second**.
One `Notification` row per recipient and one `DeliveryLog` per recipient per
channel are written inside the caller's transaction; only then is delivery
dispatched. A worker that dies has lost delivery attempts, never the record that
the notification was owed, and a support case ("the parent says they never got the
absence alert") is answerable from the database alone.

What is deliberately **not** here, all communication-module scope (Tier 4):
quiet-hours deferral, suppression lists, SMS quotas, and provider status
webhooks. Until those exist every trigger delivers at §4's mandatory floor — the
in-app row always, on top of whatever the preference resolver decides for the
rest — which is the safe direction to be wrong in.

**Per-channel rendering (Tier 4).** Every channel used to reuse the single
in-app-rendered `(title, body)` stored on `Notification` — correct for the
platform-only, no-overrides world this module shipped into, but it means a
tenant editing "the SMS wording" was actually editing every channel's wording at
once with no way to differ. `notify()` now resolves and renders each channel's
own template (`templates.resolve`, tenant-override-aware) once per call — not
once per recipient, since `context` is shared across the whole fan-out — and
stores the result on that channel's `DeliveryLog.subject`/`.body`. In-app is the
one exception: there is no separate in-app "send", so its rendering stays where
it always was, on `Notification.title`/`body`, and `DeliveryLog` rows for
`in_app` leave `subject`/`body` `NULL`. Rendering still happens **inside this
function's transaction**, from the same `context` argument the in-app render
already used — no additional PII is newly persisted; the delivery row simply
gets its own copy of what was already being read at that instant.

**Preference gating (Tier 4).** `set_preference_resolver()` registers a callable
`apps.communication` plugs in at `AppConfig.ready()`, mirroring
`templates.set_override_resolver()` exactly, for the same reason: this module
must not import a Tier-4 app. Two channels are never gated, regardless of what
the resolver returns: the mandatory in-app channel (`catalog.MANDATORY_CHANNEL`),
and every channel on an `emergency`-category trigger — both are §4's "cannot be
configured away" floor, so neither is ever even looked up.

The resolver is **batch-shaped**: `(user_ids, event_category, channel, tenant_id)
-> {user_id: is_enabled}`, called once per gated channel in `notify()` — not once
per recipient. A single-item signature was tried first and reverted: it made
`_delivery_for`'s per-(recipient, channel) construction call into the resolver on
every iteration, which is the exact per-recipient round-trip `resolve_addresses`
above already avoids for email lookups, reintroduced for preferences instead. A
40-guardian announcement across 2 channels was up to 80 calls into whatever the
resolver does (a cache lookup at best, a query at worst) where the email lookup
above costs one query for the same fan-out.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable
from dataclasses import dataclass

from django.db import transaction

from core.notifications.adapters import available_channels
from core.notifications.catalog import MANDATORY_CHANNEL, Trigger
from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    DeliveryLog,
    DeliveryStatus,
    Notification,
    NotificationCategory,
    NotificationChannel,
)
from core.notifications.templates import TemplateError
from core.notifications.templates import resolve as resolve_template

logger = logging.getLogger(__name__)


class UnknownTrigger(Exception):
    """An event key no module declared in its `notifications.py`."""


_PreferenceResolver = Callable[[list[uuid.UUID], str, str, uuid.UUID], dict[uuid.UUID, bool]]
_preference_resolver: _PreferenceResolver | None = None


def set_preference_resolver(fn: _PreferenceResolver | None) -> None:
    """Register (or clear, with `None`) the per-user channel-preference check.

    Called once from `apps.communication.apps.CommunicationConfig.ready()`. `fn`
    takes `(user_ids, event_category, channel, tenant_id)` and returns a
    `{user_id: is_enabled}` map for exactly the ids given — a missing key means
    enabled, the same "no row = enabled" default `apps.communication` itself
    documents. No resolver registered (the default, and every state before
    communication's app-ready runs) means every channel is enabled — the
    mandatory-floor-safe direction, and byte-identical to this module's
    behaviour before preferences existed.
    """
    global _preference_resolver
    _preference_resolver = fn


def _enabled_map_for_channel(
    *, tenant_id: uuid.UUID, recipients: list[Recipient], category: str, channel: str
) -> dict[uuid.UUID, bool]:
    """One resolver call for the whole recipient list, or `{}` (= everyone enabled)
    for a channel/category this module's own floor already exempts from gating."""
    if channel == MANDATORY_CHANNEL or category == NotificationCategory.EMERGENCY:
        return {}
    if _preference_resolver is None:
        return {}
    return _preference_resolver([r.user_id for r in recipients], category, channel, tenant_id)


@dataclass(frozen=True)
class Recipient:
    """A resolved recipient, identified by their user row.

    `user_id` is the only field because `notifications.user_id` is NOT NULL: in-app
    is the mandatory channel and an inbox row with no owner has nowhere to appear.
    Every other address (email now, phone later) is resolved from the user record
    at send time rather than carried here — see `resolve_addresses`.
    """

    user_id: uuid.UUID


def resolve_addresses(user_ids: list[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Email address per user id, in one query.

    Resolved at both persist and send time rather than passed in by the caller:
    one bulk query beats an N+1 over a class of forty, and re-resolving at send
    time means a guardian who corrected their email between the trigger firing and
    the worker running gets the message at the new address.
    """
    from core.rbac.models import User

    rows = User.objects.filter(pk__in=user_ids).values_list("pk", "email")
    return {pk: email for pk, email in rows if email}


def mask_address(address: str) -> str:
    """Mask a delivery address for storage.

    `delivery_logs.recipient_address` is spec'd as "stored masked per PII policy",
    and this is one of the highest-volume tables in the platform — an unmasked copy
    of every guardian's email, retained for operational history, is exactly the
    secondary PII store security.md exists to prevent. Enough survives to correlate
    a support case; not enough to re-contact anyone.
    """
    if not address:
        return ""
    if "@" in address:
        local, _, domain = address.partition("@")
        return f"{local[:2]}{'*' * max(len(local) - 2, 1)}@{domain}"
    return f"{'*' * max(len(address) - 4, 1)}{address[-4:]}"


@transaction.atomic
def notify(
    event_key: str,
    *,
    tenant_id: uuid.UUID,
    recipients: list[Recipient],
    context: dict[str, object],
    source_type: str | None = None,
    source_id: uuid.UUID | None = None,
) -> list[Notification]:
    """Persist a notification per recipient, then queue its deliveries.

    Returns the persisted rows. Callers never wait for delivery — anything with an
    outbound effect is asynchronous (api-architecture.md §2.7).
    """
    trigger = catalog.get(event_key)
    if trigger is None:
        raise UnknownTrigger(
            f"No notification trigger declared for {event_key!r}. Declare it in the "
            "emitting module's notifications.py — see core/notifications/catalog.py."
        )

    missing = trigger.variables - set(context)
    if missing:
        raise TemplateError(
            f"Trigger {event_key!r} requires context variables: {', '.join(sorted(missing))}"
        )

    in_app = resolve_template(
        trigger.template_code, NotificationChannel.IN_APP, tenant_id=tenant_id
    )
    if in_app is None:
        # The mandatory channel has no template, so there is nothing to put in the
        # inbox: the trigger is declared wrongly. Only reachable by a coding error, and
        # loud rather than a silently emptier fan-out.
        raise TemplateError(
            f"Trigger {trigger.event_key!r} has no in-app template "
            f"({trigger.template_code!r}) — the mandatory channel cannot be skipped."
        )

    title, body = in_app.render(context)
    emails = resolve_addresses([r.user_id for r in recipients])

    # Every other channel resolves and renders once for the whole call — not once
    # per recipient, since `context` is shared across the whole fan-out — and the
    # result rides on that channel's own DeliveryLog row rather than being folded
    # into title/body above. A channel with no template at all renders to None
    # rather than raising: only the mandatory in-app channel is required to exist.
    rendered_by_channel: dict[str, tuple[str, str]] = {}
    for channel in trigger.channels:
        if channel == NotificationChannel.IN_APP:
            continue
        template = resolve_template(trigger.template_code, channel, tenant_id=tenant_id)
        if template is not None:
            rendered_by_channel[channel] = template.render(context)

    # One resolver call per channel for the whole recipient list, not one call
    # per (recipient, channel) inside _delivery_for — see the module docstring's
    # "Preference gating" section for the fan-out cost that shape used to have.
    enabled_by_channel: dict[str, dict[uuid.UUID, bool]] = {
        channel: _enabled_map_for_channel(
            tenant_id=tenant_id, recipients=recipients, category=trigger.category, channel=channel
        )
        for channel in trigger.channels
    }

    # Two bulk writes for the whole fan-out, not two per recipient. An absence
    # alert to a class of forty guardians was eighty round trips; §5 explicitly
    # expects one announcement to reach thousands.
    created = _persist_many(
        trigger=trigger,
        tenant_id=tenant_id,
        recipients=recipients,
        title=title,
        body=body,
        rendered_by_channel=rendered_by_channel,
        enabled_by_channel=enabled_by_channel,
        emails=emails,
        source_type=source_type,
        source_id=source_id,
    )

    if created:
        # on_commit, never inside the transaction: a worker that starts while these
        # rows are still uncommitted would find nothing and fail every delivery.
        ids = [n.pk for n in created]
        transaction.on_commit(lambda: _dispatch(tenant_id, ids))

    return created


def _persist_many(
    *,
    trigger: Trigger,
    tenant_id: uuid.UUID,
    recipients: list[Recipient],
    title: str,
    body: str,
    rendered_by_channel: dict[str, tuple[str, str]],
    enabled_by_channel: dict[str, dict[uuid.UUID, bool]],
    emails: dict[uuid.UUID, str],
    source_type: str | None,
    source_id: uuid.UUID | None,
) -> list[Notification]:
    """One `bulk_create` for the notifications, one for every delivery row.

    `bulk_create` returns the instances with their primary keys populated on
    PostgreSQL, which is what lets the delivery rows reference them without a
    second read.
    """
    data = {"source_type": source_type, "source_id": str(source_id)} if source_id else None

    notifications = Notification.objects.bulk_create(
        [
            Notification(
                tenant_id=tenant_id,
                user_id=recipient.user_id,
                event_key=trigger.event_key,
                category=trigger.category,
                priority=trigger.priority,
                title=title,
                body=body,
                data=data,
                source_type=source_type,
                source_id=source_id,
            )
            for recipient in recipients
        ],
        batch_size=500,
    )

    DeliveryLog.objects.bulk_create(
        [
            _delivery_for(
                notification=notification,
                tenant_id=tenant_id,
                channel=channel,
                trigger=trigger,
                recipient=recipient,
                email=emails.get(recipient.user_id),
                rendered=rendered_by_channel.get(channel),
                enabled=enabled_by_channel.get(channel, {}).get(recipient.user_id, True),
            )
            for notification, recipient in zip(notifications, recipients, strict=True)
            for channel in sorted(trigger.channels)
        ],
        batch_size=500,
    )
    return notifications


def _delivery_for(
    *,
    notification: Notification,
    tenant_id: uuid.UUID,
    channel: str,
    trigger: Trigger,
    recipient: Recipient,
    email: str | None,
    rendered: tuple[str, str] | None,
    enabled: bool,
) -> DeliveryLog:
    address = str(recipient.user_id) if channel == NotificationChannel.IN_APP else None
    if channel == NotificationChannel.EMAIL:
        address = email

    # `skipped` with a reason rather than no row at all, per §6: a send that did
    # not happen is recorded, never silently dropped — that is what makes a
    # delivery dashboard worth looking at. A missing address is checked before
    # a disabled preference: a recipient with neither should see the address
    # problem, since fixing the preference alone still would not deliver anything.
    if channel not in available_channels():
        reason: str | None = f"No adapter for {channel} yet."
    elif channel != NotificationChannel.IN_APP and rendered is None:
        reason = f"No {channel} template for {trigger.template_code}."
    elif not address:
        reason = f"Recipient has no {channel} address."
    elif not enabled:
        reason = "Disabled by user preference."
    else:
        reason = None

    # `rendered` is only ever populated for non-in-app channels — see notify()'s
    # rendered_by_channel loop, which skips IN_APP on purpose.
    subject, body = rendered if rendered is not None else (None, None)

    return DeliveryLog(
        tenant_id=tenant_id,
        notification=notification,
        channel=channel,
        template_code=trigger.template_code,
        subject=subject,
        body=body,
        recipient_address=mask_address(address or ""),
        status=DeliveryStatus.QUEUED if reason is None else DeliveryStatus.SKIPPED,
        error_message=reason,
    )


def _dispatch(tenant_id: uuid.UUID, notification_ids: list[uuid.UUID]) -> None:
    from core.notifications.tasks import deliver_notifications

    deliver_notifications.delay(
        tenant_id=str(tenant_id), notification_ids=[str(pk) for pk in notification_ids]
    )
