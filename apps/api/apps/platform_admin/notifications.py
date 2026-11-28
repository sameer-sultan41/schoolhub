"""Notification triggers the platform console sends to schools (platform-admin.md §12).

v1 notifies the school's owners only: `notify()` is per tenant, so §12's copies to
`platform_super_admin` and "platform ops" wait for a platform-ops channel
(docs/deferred-work.md). The owner invite itself is not here: it is ADR-0033's invitation
email (`InvitationKind.OWNER`), sent through `core.rbac.auth_emails`.

No dedupe check before sending a lifecycle notice: it fires once per transition, and
`lifecycle.transition` makes each transition under the tenant row's lock, so a retry finds the
tenant already moved and is refused before it gets here. Deduping on the tenant would wrongly
silence a school's second suspension.

The sweeps' notices (`platform.trial-expiring`, `platform.payment-failed`) and
`platform.quota-threshold` dedupe, through `notify_owners_once`, on a key more specific than the
school: the trial's end and the threshold, the subscription's period, or the metric, band and
period. A rerun sends nothing twice, and the school's next
trial or next period still gets its own notice.
"""

from __future__ import annotations

import logging
import uuid

from django.db import transaction

from core.notifications.catalog import registry as catalog
from core.notifications.models import (
    NotificationCategory,
    NotificationChannel,
    NotificationPriority,
)
from core.notifications.templates import registry as templates
from core.rbac.models import User
from core.rbac.roles import SCHOOL_OWNER
from core.tenancy.context import tenant_context
from core.tenancy.models import Tenant

logger = logging.getLogger(__name__)

TENANT_SUSPENDED = "platform.tenant-suspended"
TENANT_REINSTATED = "platform.tenant-reinstated"
TRIAL_EXPIRING = "platform.trial-expiring"
PAYMENT_FAILED = "platform.payment-failed"
QUOTA_THRESHOLD = "platform.quota-threshold"
IMPERSONATION = "platform.impersonation"

_VARIABLES = {"school.name"}

for _code, _description, _subject, _body, _variables in (
    (
        TENANT_SUSPENDED,
        "The school's account was suspended.",
        "{{ school.name }} has been suspended",
        "Access to {{ school.name }} on SchoolHub has been suspended. Your data is kept "
        "unchanged. Please contact SchoolHub support to restore access.",
        _VARIABLES,
    ),
    (
        TENANT_REINSTATED,
        "The school's account was reinstated after a suspension.",
        "{{ school.name }} has been reinstated",
        "Access to {{ school.name }} on SchoolHub has been restored. Everyone can sign in again.",
        _VARIABLES,
    ),
    (
        TRIAL_EXPIRING,
        "The school's trial ends soon (PLATFORM_TRIAL_REMINDER_DAYS).",
        "{{ school.name }}: your trial ends in {{ trial.days_left }} days",
        "The SchoolHub trial for {{ school.name }} ends on {{ trial.ends_on }}, in "
        "{{ trial.days_left }} days. Choose a plan before then to keep access; after it, the "
        "school is suspended until a plan starts.",
        {*_VARIABLES, "trial.days_left", "trial.ends_on"},
    ),
    (
        PAYMENT_FAILED,
        "The school's subscription payment failed; access continues through the grace period.",
        "{{ school.name }}: your SchoolHub payment failed",
        "We could not collect the SchoolHub payment for {{ school.name }}. Access continues "
        "until {{ grace.ends_on }}. Please settle the payment before then, or the school will "
        "be suspended.",
        {*_VARIABLES, "grace.ends_on"},
    ),
    (
        QUOTA_THRESHOLD,
        "The school's usage reached the warn band (PLATFORM_QUOTA_WARN_RATIO) or the limit.",
        "{{ school.name }}: {{ quota.usage }} of {{ quota.limit }} {{ quota.metric }} used",
        "{{ school.name }} is using {{ quota.usage }} of the {{ quota.limit }} "
        "{{ quota.metric }} its SchoolHub plan includes. At the limit, further additions are "
        "refused until the plan or its limits change.",
        {*_VARIABLES, "quota.metric", "quota.usage", "quota.limit"},
    ),
):
    catalog.register(
        _code,
        template_code=_code,
        category=NotificationCategory.GENERAL,
        priority=NotificationPriority.HIGH,
        # Email as well: while suspended, nobody at the school can sign in to read the inbox.
        channels={NotificationChannel.EMAIL},
        variables=_variables,
        description=_description,
    )
    for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
        templates.register(
            _code, channel=_channel, subject=_subject, body=_body, variables=_variables
        )


# In-app only (§12): a support session starting or ending is a notice for the owners' inbox, not
# mail. One code for both, the event word says which.
_IMPERSONATION_VARIABLES = {
    *_VARIABLES,
    "impersonation.event",
    "impersonation.operator",
    "impersonation.target",
    "impersonation.reason",
    "impersonation.timing",
}
catalog.register(
    IMPERSONATION,
    template_code=IMPERSONATION,
    category=NotificationCategory.GENERAL,
    priority=NotificationPriority.HIGH,
    variables=_IMPERSONATION_VARIABLES,
    description="SchoolHub support started or ended a session signed in as a school user.",
)
templates.register(
    IMPERSONATION,
    channel=NotificationChannel.IN_APP,
    subject="{{ school.name }}: a SchoolHub support session {{ impersonation.event }}",
    body=(
        "{{ impersonation.operator }} {{ impersonation.event }} a session signed in as "
        "{{ impersonation.target }}. Reason: {{ impersonation.reason }}. "
        "{{ impersonation.timing }} Every change made in it is recorded in the audit log "
        "under both names."
    ),
    variables=_IMPERSONATION_VARIABLES,
)


def school_owners(tenant: Tenant) -> list[User]:
    """The school's active logins that hold the `school_owner` role."""
    return list(
        User.objects.filter(
            tenant_id=tenant.pk,
            is_active=True,
            deleted_at__isnull=True,
            user_roles__deleted_at__isnull=True,
            user_roles__role__slug=SCHOOL_OWNER,
            user_roles__role__deleted_at__isnull=True,
        ).distinct()
    )


def notify_owners(
    tenant: Tenant,
    event_key: str,
    *,
    context: dict[str, object] | None = None,
    source_type: str = "tenant",
    source_id: uuid.UUID | None = None,
) -> int:
    """Send ``event_key`` to the school's owners; returns how many. Never raises.

    A failure never undoes the transition or the sweep step that sent it. The tenant is
    bound for the write (`notifications` has an RLS policy), and the send is savepointed for
    the reason `core.audit.services.record_audit` gives.
    """
    from core.notifications.services import Recipient, notify

    try:
        with transaction.atomic(), tenant_context(tenant.pk):
            owners = school_owners(tenant)
            if not owners:
                return 0
            notify(
                event_key,
                tenant_id=tenant.pk,
                recipients=[Recipient(user_id=owner.pk) for owner in owners],
                context={"school.name": tenant.name, **(context or {})},
                source_type=source_type,
                source_id=source_id or tenant.pk,
            )
            return len(owners)
    except Exception:
        logger.exception("%s notification failed for tenant %s", event_key, tenant.pk)
        return 0


# The namespace of the sweeps' dedupe keys: a stable UUID per (school, notice, occasion).
_DEDUPE_NAMESPACE = uuid.UUID("6f1d3c2a-5b0e-4d8a-9c7e-2a4b8e1f0d35")


def dedupe_key(tenant: Tenant, event_key: str, occasion: str) -> uuid.UUID:
    """The `source_id` a sweep's notice carries: one per school, notice and occasion."""
    return uuid.uuid5(_DEDUPE_NAMESPACE, f"{tenant.pk}:{event_key}:{occasion}")


def notify_owners_once(
    tenant: Tenant, event_key: str, *, occasion: str, context: dict[str, object]
) -> int:
    """`notify_owners`, unless this school already got ``event_key`` for ``occasion``.

    ``occasion`` is what makes the notice new: the trial's end and the threshold, or the
    unpaid period's end. `notify()` does not dedupe, so the check is here; the caller holds
    the tenant row's lock, so two runs cannot both pass it.
    """
    from core.notifications.models import Notification

    key = dedupe_key(tenant, event_key, occasion)
    with tenant_context(tenant.pk):
        sent = Notification.objects.filter(
            event_key=event_key, source_type="platform", source_id=key
        ).exists()
    if sent:
        return 0
    return notify_owners(tenant, event_key, context=context, source_type="platform", source_id=key)
