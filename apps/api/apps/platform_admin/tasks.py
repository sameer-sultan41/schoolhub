"""The platform console's beat sweeps and the notices they send (platform-admin.md §7.2, §12).

Each sweep picks its candidates from the platform-scope `tenants` table, with nothing bound,
then handles one school at a time in that school's own transaction (`tenant_atomic`), with
its `tenants` row locked and its state checked again: an operator may have moved the school
since the candidates were read. One school failing is logged and the sweep goes on.

Sweeps run on the `bulk` queue; the two notices on `transactional` (ruling C5,
`CELERY_TASK_ROUTES`). Every system write passes ``actor_id=None`` and is audited through
`record_system_audit` (ruling A3).
"""

from __future__ import annotations

import logging
import math
import uuid
from collections.abc import Callable
from datetime import datetime, timedelta

from celery import shared_task
from django.conf import settings
from django.utils import timezone

from apps.platform_admin import notifications
from apps.platform_admin.flags.services import lapse_expired_overrides
from apps.platform_admin.models import Subscription, SubscriptionStatus
from apps.platform_admin.tenants import lifecycle
from core.tenancy.context import tenant_atomic
from core.tenancy.maintenance import for_each_tenant
from core.tenancy.models import Tenant, TenantStatus

logger = logging.getLogger(__name__)

S = TenantStatus
TRIAL_EXPIRED = "The trial ended without a plan."
GRACE_ENDED = "The payment grace period ended."


def _each(tenant_ids: list[uuid.UUID], step: Callable[[uuid.UUID], bool], *, job: str) -> dict:
    """Run ``step`` for each school; count the ones it acted on and the ones that failed."""
    affected = failed = 0
    for tenant_id in tenant_ids:
        try:
            affected += bool(step(tenant_id))
        except Exception:
            failed += 1
            logger.exception("%s failed for tenant %s", job, tenant_id)
    logger.info(
        "%s: %d school(s), %d acted on, %d failure(s)", job, len(tenant_ids), affected, failed
    )
    return {"tenants": len(tenant_ids), "affected": affected, "failed": failed}


def _candidates(**filters) -> list[uuid.UUID]:
    return list(
        Tenant.objects.filter(deleted_at__isnull=True, **filters).values_list("pk", flat=True)
    )


def _locked(tenant_id: uuid.UUID) -> Tenant:
    return Tenant.objects.select_for_update().get(pk=tenant_id)


# ------------------------------------------------------------------------------- trials


def _threshold(trial_ends_at: datetime, now: datetime) -> int | None:
    """The reminder day the trial has reached: the smallest threshold it is within."""
    days_left = (trial_ends_at - now) / timedelta(days=1)
    reached = [d for d in settings.PLATFORM_TRIAL_REMINDER_DAYS if days_left <= d]
    return min(reached) if reached and days_left > 0 else None


@shared_task
def trial_reminders() -> dict:
    """Daily: remind each trial school's owners at each `PLATFORM_TRIAL_REMINDER_DAYS` mark.

    A school that crossed two marks since the last run (a short trial, a missed tick) gets
    the nearer one only. The notice task dedupes per trial end and mark.
    """
    now = timezone.now()
    horizon = now + timedelta(days=max(settings.PLATFORM_TRIAL_REMINDER_DAYS, default=0))
    due = Tenant.objects.filter(
        deleted_at__isnull=True,
        status=S.TRIAL,
        trial_ends_at__gt=now,
        trial_ends_at__lte=horizon,
    ).values_list("pk", "trial_ends_at")
    queued = 0
    for tenant_id, trial_ends_at in due:
        threshold = _threshold(trial_ends_at, now)
        if threshold is not None:
            send_trial_expiring_notice.delay(tenant_id=str(tenant_id), threshold_days=threshold)
            queued += 1
    return {"queued": queued}


@shared_task
def send_trial_expiring_notice(*, tenant_id: str, threshold_days: int) -> int:
    """`platform.trial-expiring` to the school's owners, once per trial end and mark.

    The trial end is read again under the lock, from `tenants.trial_ends_at`, the source of
    truth (a reinstated trial does not move the subscription's period).
    """
    with tenant_atomic(uuid.UUID(tenant_id)):
        tenant = _locked(uuid.UUID(tenant_id))
        if tenant.status != S.TRIAL or tenant.trial_ends_at is None:
            return 0
        days_left = max(math.ceil((tenant.trial_ends_at - timezone.now()) / timedelta(days=1)), 0)
        return notifications.notify_owners_once(
            tenant,
            notifications.TRIAL_EXPIRING,
            occasion=f"{tenant.trial_ends_at.isoformat()}:{threshold_days}",
            context={
                "trial.days_left": days_left,
                "trial.ends_on": tenant.trial_ends_at.date().isoformat(),
            },
        )


def _expire_trial(tenant_id: uuid.UUID) -> bool:
    with tenant_atomic(tenant_id):
        tenant = _locked(tenant_id)
        if (
            tenant.status != S.TRIAL
            or tenant.trial_ends_at is None
            or tenant.trial_ends_at > timezone.now()
        ):
            return False
        lifecycle.transition(tenant, S.SUSPENDED, actor_id=None, reason=TRIAL_EXPIRED)
        return True


@shared_task
def expire_trials() -> dict:
    """Daily: suspend each trial school whose `trial_ends_at` has passed (§7.1)."""
    candidates = _candidates(status=S.TRIAL, trial_ends_at__lte=timezone.now())
    return _each(candidates, _expire_trial, job="expire-trials")


# ------------------------------------------------------------------------------ dunning


def _grace_ends(sub: Subscription) -> datetime:
    """Dunning runs from the end of the unpaid period, the date the payment was due."""
    return sub.current_period_end + timedelta(days=settings.PLATFORM_DUNNING_GRACE_DAYS)


def _past_due_subscription() -> Subscription | None:
    return Subscription.objects.filter(
        status=SubscriptionStatus.PAST_DUE, deleted_at__isnull=True
    ).first()


def _dun(tenant_id: uuid.UUID) -> bool:
    """Suspend the school once its grace has run out; until then, make sure it was told."""
    with tenant_atomic(tenant_id):
        tenant = _locked(tenant_id)
        sub = _past_due_subscription() if tenant.status == S.PAST_DUE else None
        if sub is None:
            return False
        if timezone.now() >= _grace_ends(sub):
            lifecycle.transition(tenant, S.SUSPENDED, actor_id=None, reason=GRACE_ENDED)
            return True
    send_payment_failed_notice.delay(tenant_id=str(tenant_id))
    return False


@shared_task
def dunning_sweep() -> dict:
    """Daily: suspend each past-due school past `PLATFORM_DUNNING_GRACE_DAYS` (§7.2)."""
    return _each(_candidates(status=S.PAST_DUE), _dun, job="dunning-sweep")


@shared_task
def send_payment_failed_notice(*, tenant_id: str) -> int:
    """`platform.payment-failed` to the school's owners, once per unpaid period.

    Sent by the webhook when a failure arrives, and by the dunning sweep for a failure an
    operator marked; the period's end makes the second a no-op.
    """
    with tenant_atomic(uuid.UUID(tenant_id)):
        tenant = _locked(uuid.UUID(tenant_id))
        sub = _past_due_subscription() if tenant.status == S.PAST_DUE else None
        if sub is None:
            return 0
        return notifications.notify_owners_once(
            tenant,
            notifications.PAYMENT_FAILED,
            occasion=sub.current_period_end.isoformat(),
            context={"grace.ends_on": _grace_ends(sub).date().isoformat()},
        )


# ---------------------------------------------------------------------------- overrides


@shared_task
def lapse_overrides() -> dict[str, int]:
    """Hourly: retire flag overrides past their `expires_at`, school by school.

    Every school is a candidate: which ones hold an expired override is itself under RLS.
    """
    return for_each_tenant(lapse_expired_overrides, job="lapse-overrides")
