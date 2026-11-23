"""Applying a verified billing event to the school it names (§7.2).

The school is found through the platform-scope `tenants.billing_provider_ref`, so the lookup
needs nothing bound. Then, in one transaction with that school bound (ruling A6), the event
is claimed (a `BillingEventReceipt`, unique per provider and event id) and applied through
the subscription services as a system caller (``actor_id=None``, ruling A3).

Claiming first makes the event idempotent: a replay finds the receipt and does nothing, and
a concurrent duplicate waits on the unique index, then finds it too. An event the
subscription's current status cannot take (a failure for a school already past due, a
payment for a trial) is recorded as ``ignored``, not refused: the provider would only retry it.

Out-of-order delivery is not detected: a ``payment_failed`` carries no period, so a delayed
failure for an earlier period, arriving after a later payment, still moves an ``active``
school to ``past_due``. Only the fake adapter exists; a real one must carry the invoice
period or occurrence time and ignore a failure for a period already paid (deferred-work.md).

The reference names the school only for the provider the subscription is billed through: an
event from another provider for the same reference is recorded ``unknown_ref``.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass

from django.db import IntegrityError, transaction
from rest_framework.exceptions import APIException

from apps.platform_admin.billing.base import BillingEvent
from apps.platform_admin.models import BillingEventReceipt, BillingOutcome
from apps.platform_admin.subscriptions import services as subscriptions
from core.tenancy.context import bind_tenant, unbind_tenant
from core.tenancy.models import Tenant

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class Handled:
    """What `handle_event` did: the outcome, the school named, and whether the receipt is new."""

    outcome: str
    tenant: Tenant | None
    is_new: bool


def handle_event(provider: str, event: BillingEvent) -> Handled:
    """Apply ``event`` once.

    A replay returns the first receipt's outcome, ``is_new=False``, and changes nothing.
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
                return Handled(previous.outcome, tenant, is_new=False)
            receipt.outcome = _apply(provider, event, tenant)
            receipt.save(update_fields=["outcome", "updated_at"])
            return Handled(receipt.outcome, tenant, is_new=True)
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


def _apply(provider: str, event: BillingEvent, tenant: Tenant | None) -> str:
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
    if sub.billing_provider != provider:
        logger.warning(
            "billing event %s from %s names school %s, which bills through %r",
            event.event_id,
            provider,
            tenant.pk,
            sub.billing_provider,
        )
        return BillingOutcome.UNKNOWN_REF
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
