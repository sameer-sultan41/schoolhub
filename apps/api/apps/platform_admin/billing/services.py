"""Applying a verified billing event to the school it names (§7.2).

The school is found through the platform-scope `tenants.billing_provider_ref`, so the lookup
needs nothing bound. Then, in one transaction with that school bound (ruling A6), the event
is claimed (a `BillingEventReceipt`, unique per provider and event id) and applied through
the subscription services as a system caller (``actor_id=None``, ruling A3).

Claiming first makes the event idempotent: a replay finds the receipt and does nothing, and
a concurrent duplicate waits on the unique index, then finds it too. An event the
subscription cannot take (out of order, or a state it has left) is recorded as ``ignored``,
not refused: the provider would only retry it.
"""

from __future__ import annotations

import logging

from django.db import IntegrityError, transaction
from rest_framework.exceptions import APIException

from apps.platform_admin.billing.base import BillingEvent
from apps.platform_admin.models import BillingEventReceipt, BillingOutcome
from apps.platform_admin.subscriptions import services as subscriptions
from core.tenancy.context import bind_tenant, unbind_tenant
from core.tenancy.models import Tenant

logger = logging.getLogger(__name__)


def handle_event(provider: str, event: BillingEvent) -> tuple[str, Tenant | None]:
    """Apply ``event`` once. Returns its outcome and the school it named, if any.

    A replay returns the first receipt's outcome and changes nothing.
    """
    tenant = (
        Tenant.objects.filter(billing_provider_ref=event.provider_ref, deleted_at__isnull=True)
        .exclude(billing_provider_ref="")
        .first()
    )
    with transaction.atomic():
        token = bind_tenant(tenant.pk) if tenant is not None else None
        try:
            receipt = _claim(provider, event, tenant)
            if receipt is None:
                previous = BillingEventReceipt.objects.get(
                    provider=provider, event_id=event.event_id
                )
                return previous.outcome, tenant
            receipt.outcome = _apply(event, tenant)
            receipt.save(update_fields=["outcome", "updated_at"])
            return receipt.outcome, tenant
        finally:
            if token is not None:
                unbind_tenant(token)


def _claim(provider: str, event: BillingEvent, tenant: Tenant | None) -> BillingEventReceipt | None:
    """The new receipt for ``event``, or None when it was already received."""
    try:
        with transaction.atomic():
            return BillingEventReceipt.objects.create(
                provider=provider,
                event_id=event.event_id,
                kind=event.kind,
                provider_ref=event.provider_ref,
                tenant=tenant,
                outcome=BillingOutcome.IGNORED,
            )
    except IntegrityError:
        return None


def _apply(event: BillingEvent, tenant: Tenant | None) -> str:
    if tenant is None:
        logger.warning(
            "billing event %s names no school (provider reference %s)",
            event.event_id,
            event.provider_ref,
        )
        return BillingOutcome.UNKNOWN_REF
    sub = subscriptions.live_subscription(tenant.pk)
    if sub is None:
        logger.warning(
            "billing event %s: school %s has no live subscription", event.event_id, tenant.pk
        )
        return BillingOutcome.NO_SUBSCRIPTION
    try:
        if event.kind == "payment_failed":
            subscriptions.mark_payment_failed(sub, actor_id=None)
        elif event.paid_through is not None:
            subscriptions.record_payment(sub, paid_through=event.paid_through, actor_id=None)
        else:
            return BillingOutcome.IGNORED
    except APIException as exc:
        # `InvalidTransition`, `NoLiveSubscription` or a `paid_through` the period has passed.
        logger.info("billing event %s ignored for school %s: %s", event.event_id, tenant.pk, exc)
        return BillingOutcome.IGNORED
    return BillingOutcome.APPLIED
