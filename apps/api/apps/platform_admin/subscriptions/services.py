"""Subscription services: every write moves the row, the tenant read model and the lifecycle.

Each write runs in one transaction, with the school bound (the row is under RLS) and its
`tenants` row locked, so two writes to one school's subscription run one after the other.
In order, it:
1. updates the `Subscription`;
2. mirrors it onto `tenants.current_plan`, `subscription_status` and `billing_provider_ref`,
   the platform-scope read model (ruling C1; a duplicate billing reference is a 400);
3. moves the school's lifecycle where the subscription implies it (`lifecycle.transition`);
4. invalidates the feature cache, so module access follows on the next request.

Who audits: a person's write is audited by the view (`record_audit`), as the tenant lifecycle
is. A system caller (the billing webhook, a sweep) passes ``actor_id=None`` and the service
audits itself through `record_system_audit` (ruling A3).

A school has at most one live subscription (``trialing``, ``active`` or ``past_due``): the
services refuse a second (409 ``subscription_exists``) and a partial unique index backs them.

Locks are taken school first, then plan (`subscribable_plan`), as `:provision` takes them; a
caller passes a plan's code, never a plan it locked itself. A write that puts the school on a
plan asks the disable guards first (`core.tenancy.features.plan_change_refusal`): a plan
that would switch off a module the school still needs is a 409 ``toggle_refused``.
"""

from __future__ import annotations

import contextlib
import uuid
from collections.abc import Iterator
from datetime import datetime, timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers

from apps.platform_admin.constants import QUOTA_METRICS
from apps.platform_admin.flags.services import ToggleRefused
from apps.platform_admin.models import Plan, Subscription, SubscriptionStatus
from apps.platform_admin.plans.services import subscribable_plan

# A module reference, not its names: `tenants.services` imports this module for `:provision`.
from apps.platform_admin.tenants import lifecycle
from apps.platform_admin.tenants import services as tenant_services
from apps.platform_admin.usage.limits import latest_snapshots, refuse_below_usage
from core.api.exceptions import CodedAPIException, DomainRuleViolation
from core.audit.services import record_system_audit
from core.tenancy.context import tenant_atomic, tenant_context
from core.tenancy.features import invalidate_feature_cache, plan_change_refusal
from core.tenancy.models import Tenant, TenantStatus
from core.tenancy.subscription_state import LIVE_STATES

SUB = SubscriptionStatus
S = TenantStatus
_LIVE = sorted(LIVE_STATES)

REF_TAKEN = "Another school already uses this billing reference."
PERIOD_ORDER = "The period must end after it starts."
PAID_THROUGH_TOO_EARLY = "A payment must pay beyond now and beyond the current period's end."
SAME_PLAN = "The school is already on this plan."

# The fields `PATCH /platform/tenants/{id}/subscription` may change.
EDITABLE_FIELDS = ("billing_provider", "billing_provider_ref", "limits_override")


class SubscriptionExists(CodedAPIException):
    status_code = 409
    default_detail = "This school already has a live subscription; change its plan instead."
    default_code = "subscription_exists"


# ---------------------------------------------------------------------------------- reads


def live_subscription(tenant_id: uuid.UUID) -> Subscription | None:
    """The school's live subscription, with its plan, or None.

    Binds ``tenant_id`` for the read. Call it for the school the request already binds, or
    outside any request (a task, the webhook): the binding's ``SET LOCAL`` outlasts this
    block for the rest of the surrounding transaction.
    """
    with tenant_atomic(tenant_id):
        return (
            Subscription.objects.select_related("plan")
            .filter(status__in=_LIVE, deleted_at__isnull=True)
            .first()
        )


def effective_limits(tenant_id: uuid.UUID) -> dict[str, int | None]:
    """Every quota metric's limit for the school: the live plan's, then the override's.

    ``None`` is unlimited: a metric the plan leaves out, or a school with no live
    subscription at all.
    """
    return _limits_of(live_subscription(tenant_id))


def _limits_of(sub: Subscription | None) -> dict[str, int | None]:
    if sub is None:
        return dict.fromkeys(QUOTA_METRICS)
    return _merged_limits(sub.plan.limits, sub.limits_override)


def _merged_limits(plan_limits: dict | None, override: dict | None) -> dict[str, int | None]:
    """Every metric's limit: the plan's, then the negotiated override's on top."""
    limits: dict[str, int | None] = dict.fromkeys(QUOTA_METRICS)
    for source in (plan_limits or {}, override or {}):
        limits.update({metric: value for metric, value in source.items() if metric in limits})
    return limits


def live_subscription_state(tenant: Tenant) -> str | None:
    """The `core.tenancy.subscription_state` hook: the live subscription's status, or None."""
    sub = live_subscription(tenant.pk)
    return sub.status if sub is not None else None


def plan_modules(tenant_id: uuid.UUID) -> frozenset[str] | None:
    """The plan resolver `core.tenancy.features` consults: the live plan's modules, or None.

    Reads the platform-scope read model (`tenants` and `plans`), not `subscriptions`, so it
    answers whether or not the school is bound: `is_feature_enabled` runs in requests,
    tasks and the console alike. The subscription services keep the columns in step in the
    subscription row's own transaction.
    """
    row = Tenant.objects.filter(pk=tenant_id).values("current_plan", "subscription_status").first()
    if row is None or row["subscription_status"] not in LIVE_STATES or not row["current_plan"]:
        return None
    modules = (
        Plan.objects.filter(code=row["current_plan"])
        .values_list("enabled_modules", flat=True)
        .first()
    )
    return frozenset(modules) if modules is not None else None


def describe(tenant: Tenant) -> dict:
    """The school's billing state, as both GET routes answer it."""
    current = Tenant.objects.get(pk=tenant.pk)
    sub = live_subscription(current.pk)
    return {
        "tenant_status": current.status,
        "trial_ends_at": current.trial_ends_at,
        "subscription": sub,
        "limits": _limits_of(sub),
    }


# --------------------------------------------------------------------------------- writes


def start_trial(tenant: Tenant, plan: Plan, *, actor_id: uuid.UUID | None) -> Subscription:
    """A ``trialing`` subscription to ``plan`` for ``plan.trial_days``, from now.

    The school's ``trial_ends_at`` becomes the trial's end. `:provision` calls this when it
    is given a plan, before it moves the school to ``trial``; the lifecycle is not moved here.
    ``plan`` is re-read under its lock here, after the school's.
    """
    with _writing(tenant.pk) as school:
        plan = subscribable_plan(plan.code)
        if _live_row(lock=False) is not None:
            raise SubscriptionExists()
        _refuse_guarded_drop(school, plan)
        now = timezone.now()
        sub = Subscription.objects.create(
            tenant=school,
            plan=plan,
            status=SUB.TRIALING,
            current_period_start=now,
            current_period_end=now + timedelta(days=plan.trial_days),
            created_by=actor_id,
            updated_by=actor_id,
        )
        _mirror(school, sub, trial_ends_at=sub.current_period_end)
        _finish(school, sub, "start_trial", actor_id)
    _refresh(tenant, school)
    return sub


def subscribe(
    tenant: Tenant,
    plan_code: str,
    *,
    period_start: datetime,
    period_end: datetime,
    actor_id: uuid.UUID | None,
    acknowledge_over_usage: bool = False,
) -> Subscription:
    """An ``active`` subscription to plan ``plan_code`` for a school that has none (a paid sign-up).

    A school on a trial without a plan, or one that predates plans, pays and goes straight to
    ``active``. A trial school becomes ``active``; a suspended one stays suspended until it is
    reinstated, which then follows this subscription. A school without a plan is unlimited, so
    a plan whose limits fall below its latest usage snapshot is a 409 `limit_below_usage`
    unless acknowledged.
    """
    _check_period(period_start, period_end)
    with _writing(tenant.pk) as school:
        if school.status not in (*lifecycle.OPERATIONAL, S.SUSPENDED):
            raise lifecycle.InvalidTransition(meta={"from": school.status, "to": S.ACTIVE})
        plan = subscribable_plan(plan_code)
        if _live_row(lock=False) is not None:
            raise SubscriptionExists()
        _refuse_guarded_drop(school, plan)
        refuse_below_usage(
            dict.fromkeys(QUOTA_METRICS),
            _merged_limits(plan.limits, None),
            latest_snapshots([school.pk]),
            acknowledged=acknowledge_over_usage,
        )
        sub = Subscription.objects.create(
            tenant=school,
            plan=plan,
            status=SUB.ACTIVE,
            current_period_start=period_start,
            current_period_end=period_end,
            created_by=actor_id,
            updated_by=actor_id,
        )
        _mirror(school, sub)
        _move(school, S.TRIAL, S.ACTIVE, actor_id)
        _finish(school, sub, "activate", actor_id)
    _refresh(tenant, school)
    return sub


def activate(
    sub: Subscription,
    *,
    period_start: datetime,
    period_end: datetime,
    actor_id: uuid.UUID | None,
) -> Subscription:
    """A trial converts: ``trialing`` → ``active`` for the paid period; the school follows."""
    _check_period(period_start, period_end)
    with _writing(sub.tenant_id) as school:
        row = _locked(sub, SUB.ACTIVE, allowed=(SUB.TRIALING,))
        row.status = SUB.ACTIVE
        row.current_period_start = period_start
        row.current_period_end = period_end
        _save(row, actor_id, "status", "current_period_start", "current_period_end")
        _mirror(school, row)
        _move(school, S.TRIAL, S.ACTIVE, actor_id)
        _finish(school, row, "activate", actor_id)
    return row


def record_payment(
    sub: Subscription, *, paid_through: datetime, actor_id: uuid.UUID | None
) -> Subscription:
    """A payment arrived: the period runs to ``paid_through``, and a past-due school recovers.

    The new period starts where the paid one ended, so a late payment does not shift the
    billing anniversary.
    """
    with _writing(sub.tenant_id) as school:
        row = _locked(sub, SUB.ACTIVE, allowed=(SUB.ACTIVE, SUB.PAST_DUE))
        if paid_through <= max(timezone.now(), row.current_period_end):
            raise serializers.ValidationError({"paid_through": [PAID_THROUGH_TOO_EARLY]})
        row.status = SUB.ACTIVE
        row.current_period_start = row.current_period_end
        row.current_period_end = paid_through
        _save(row, actor_id, "status", "current_period_start", "current_period_end")
        _mirror(school, row)
        _move(school, S.PAST_DUE, S.ACTIVE, actor_id)
        _finish(school, row, "record_payment", actor_id)
    return row


def mark_payment_failed(sub: Subscription, *, actor_id: uuid.UUID | None) -> Subscription:
    """A payment failed: ``active`` → ``past_due``, and the school with it (dunning starts)."""
    with _writing(sub.tenant_id) as school:
        row = _locked(sub, SUB.PAST_DUE, allowed=(SUB.ACTIVE,))
        row.status = SUB.PAST_DUE
        _save(row, actor_id, "status")
        _mirror(school, row)
        _move(school, S.ACTIVE, S.PAST_DUE, actor_id)
        _finish(school, row, "mark_payment_failed", actor_id)
    return row


def change_plan(
    sub: Subscription,
    plan_code: str,
    *,
    actor_id: uuid.UUID | None,
    acknowledge_over_usage: bool = False,
) -> Subscription:
    """Move the live subscription to the active plan ``plan_code``, at once.

    The period and status stay as they are: proration and plan versioning are deferred
    (deferred-work.md). Module access follows on the next request. A plan whose limits, with
    the school's override on top, drop below its latest usage snapshot is a 409
    `limit_below_usage` unless acknowledged.
    """
    with _writing(sub.tenant_id) as school:
        row = _locked(sub, None, allowed=tuple(_LIVE))
        plan = subscribable_plan(plan_code)
        if plan.pk == row.plan_id:
            raise DomainRuleViolation({"plan_code": SAME_PLAN})
        _refuse_guarded_drop(school, plan)
        refuse_below_usage(
            _limits_of(row),
            _merged_limits(plan.limits, row.limits_override),
            latest_snapshots([row.tenant_id]),
            acknowledged=acknowledge_over_usage,
        )
        row.plan = plan
        _save(row, actor_id, "plan")
        _mirror(school, row)
        _finish(school, row, "change_plan", actor_id)
    return row


def update_subscription(
    sub: Subscription,
    *,
    data: dict,
    actor_id: uuid.UUID | None,
    acknowledge_over_usage: bool = False,
) -> Subscription:
    """Change the billing provider, its reference or the negotiated limits.

    Lowering an effective limit below the school's latest usage snapshot is a 409
    `limit_below_usage` unless acknowledged.
    """
    with _writing(sub.tenant_id) as school:
        row = _locked(sub, None, allowed=tuple(_LIVE))
        if "limits_override" in data:
            refuse_below_usage(
                _limits_of(row),
                _merged_limits(row.plan.limits, data["limits_override"]),
                latest_snapshots([row.tenant_id]),
                acknowledged=acknowledge_over_usage,
            )
        fields = [field for field in EDITABLE_FIELDS if field in data]
        for field in fields:
            setattr(row, field, data[field])
        _save(row, actor_id, *fields)
        _mirror(school, row)
        _finish(school, row, "update", actor_id)
    return row


# -------------------------------------------------------------------------------- helpers


@contextlib.contextmanager
def _writing(tenant_id: uuid.UUID) -> Iterator[Tenant]:
    """One transaction, the school bound, and its `tenants` row locked for the write."""
    with transaction.atomic(), tenant_context(tenant_id):
        yield Tenant.objects.select_for_update().get(pk=tenant_id)


def _live_row(*, lock: bool) -> Subscription | None:
    """The bound school's live subscription, optionally locked (not its plan)."""
    rows = Subscription.objects.select_related("plan").filter(
        status__in=_LIVE, deleted_at__isnull=True
    )
    if lock:
        rows = rows.select_for_update(of=("self",))
    return rows.first()


def _locked(sub: Subscription, to: str | None, *, allowed: tuple[str, ...]) -> Subscription:
    """``sub`` re-read under a lock, which must be live and in one of ``allowed``.

    A subscription no longer live is a 409 ``no_live_subscription``; one in the wrong state
    for the move is a 409 ``invalid_transition``.
    """
    row = _live_row(lock=True)
    if row is None or row.pk != sub.pk:
        raise tenant_services.NoLiveSubscription("This school has no live subscription.")
    if row.status not in allowed:
        raise lifecycle.InvalidTransition(
            "The subscription cannot make that move from its current status.",
            meta={"from": row.status, "to": to},
        )
    return row


def _save(row: Subscription, actor_id: uuid.UUID | None, *fields: str) -> None:
    row.updated_by = actor_id
    row.save(update_fields=[*fields, "updated_by", "updated_at"])


def _mirror(school: Tenant, sub: Subscription, **extra: object) -> None:
    """Write the subscription onto the `tenants` read model, in this transaction."""
    live = sub.status in LIVE_STATES
    values = {
        "current_plan": sub.plan.code if live else "",
        "subscription_status": sub.status if live else "",
        "billing_provider_ref": sub.billing_provider_ref if live else "",
        **extra,
    }
    for field, value in values.items():
        setattr(school, field, value)
    try:
        with transaction.atomic():
            school.save(update_fields=[*values, "updated_at"])
    except IntegrityError as exc:
        # `tenants_unique_billing_provider_ref`: the reference names another school.
        raise serializers.ValidationError({"billing_provider_ref": [REF_TAKEN]}) from exc


def _move(school: Tenant, source: str, to: str, actor_id: uuid.UUID | None) -> None:
    """Move the school ``source`` → ``to`` if it is at ``source``; otherwise leave it.

    A suspended school stays suspended through any billing change: `:reinstate` then follows
    the subscription.
    """
    if school.status == source:
        lifecycle.transition(school, to, actor_id=actor_id)


def _finish(school: Tenant, sub: Subscription, action: str, actor_id: uuid.UUID | None) -> None:
    if actor_id is None:
        record_system_audit(school.pk, action, sub, context=snapshot(sub))
    invalidate_feature_cache()


def snapshot(sub: Subscription) -> dict:
    """A subscription as its audit rows record it."""
    return {
        "plan": sub.plan.code,
        "status": sub.status,
        "current_period_start": sub.current_period_start.isoformat(),
        "current_period_end": sub.current_period_end.isoformat(),
        "billing_provider": sub.billing_provider,
        "billing_provider_ref": sub.billing_provider_ref,
        "limits_override": sub.limits_override,
    }


def grace_ends(sub: Subscription) -> datetime:
    """When a past-due school's grace runs out: dunning runs from the unpaid period's end."""
    return sub.current_period_end + timedelta(days=settings.PLATFORM_DUNNING_GRACE_DAYS)


def _refuse_guarded_drop(school: Tenant, plan: Plan) -> None:
    """409 ``toggle_refused`` when ``plan`` would switch off a module the school still needs."""
    refusal = plan_change_refusal(school.pk, frozenset(plan.enabled_modules or ()))
    if refusal is not None:
        key, reason = refusal
        raise ToggleRefused(reason, meta={"flag": key})


def _check_period(start: datetime, end: datetime) -> None:
    if end <= start:
        raise serializers.ValidationError({"current_period_end": [PERIOD_ORDER]})


def _refresh(tenant: Tenant, school: Tenant) -> None:
    """Carry the locked row's new values onto the caller's instance, as `transition` does."""
    for field in ("status", "trial_ends_at", "current_plan", "subscription_status"):
        setattr(tenant, field, getattr(school, field))
