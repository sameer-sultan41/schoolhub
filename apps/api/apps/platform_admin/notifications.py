"""Notification triggers the platform console sends to schools (platform-admin.md §12).

v1 notifies the school's owners only: `notify()` is per tenant, so §12's copies to
`platform_super_admin` and "platform ops" wait for a platform-ops channel
(docs/deferred-work.md). The owner invite itself is not here: it is ADR-0033's invitation
email (`InvitationKind.OWNER`), sent through `core.rbac.auth_emails`.

No dedupe check before sending, unlike the sweeps' notices: a lifecycle notice fires once per
transition, and `lifecycle.transition` makes each transition under the tenant row's lock, so a
retry finds the tenant already moved and is refused before it gets here. Deduping on the
tenant would wrongly silence a school's second suspension.
"""

from __future__ import annotations

import logging

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

_VARIABLES = {"school.name"}

for _code, _description, _subject, _body in (
    (
        TENANT_SUSPENDED,
        "The school's account was suspended.",
        "{{ school.name }} has been suspended",
        "Access to {{ school.name }} on SchoolHub has been suspended. Your data is kept "
        "unchanged. Please contact SchoolHub support to restore access.",
    ),
    (
        TENANT_REINSTATED,
        "The school's account was reinstated after a suspension.",
        "{{ school.name }} has been reinstated",
        "Access to {{ school.name }} on SchoolHub has been restored. Everyone can sign in again.",
    ),
):
    catalog.register(
        _code,
        template_code=_code,
        category=NotificationCategory.GENERAL,
        priority=NotificationPriority.HIGH,
        # Email as well: while suspended, nobody at the school can sign in to read the inbox.
        channels={NotificationChannel.EMAIL},
        variables=_VARIABLES,
        description=_description,
    )
    for _channel in (NotificationChannel.IN_APP, NotificationChannel.EMAIL):
        templates.register(
            _code, channel=_channel, subject=_subject, body=_body, variables=_VARIABLES
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


def notify_owners(tenant: Tenant, event_key: str) -> None:
    """Send ``event_key`` to the school's owners. Never lets a failure undo the transition.

    The tenant is bound for the write (`notifications` has an RLS policy), and the send is
    savepointed for the reason `core.audit.services.record_audit` gives.
    """
    from core.notifications.services import Recipient, notify

    try:
        with transaction.atomic(), tenant_context(tenant.pk):
            owners = school_owners(tenant)
            if not owners:
                return
            notify(
                event_key,
                tenant_id=tenant.pk,
                recipients=[Recipient(user_id=owner.pk) for owner in owners],
                context={"school.name": tenant.name},
                source_type="tenant",
                source_id=tenant.pk,
            )
    except Exception:
        logger.exception("%s notification failed for tenant %s", event_key, tenant.pk)
