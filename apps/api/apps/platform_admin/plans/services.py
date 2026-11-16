"""The plan catalog's writes, and the one lookup every subscription write uses.

Plans are platform scope: none of this binds a tenant. "Is this plan in use?" reads
`tenants.current_plan`, the read model the subscription services keep in step, since the
RLS-bound `subscriptions` table answers nothing with no school bound.
"""

from __future__ import annotations

import uuid

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers

from apps.platform_admin.models import Plan
from core.api.exceptions import CodedAPIException, DomainRuleViolation
from core.tenancy.features import invalidate_feature_cache
from core.tenancy.models import Tenant

CODE_FROZEN = "A plan's code cannot change once created."
CODE_TAKEN = "Another plan already uses this code."

# The fields `PATCH /platform/plans/{id}` may change. `code` is not one: it is immutable.
EDITABLE_FIELDS = (
    "name",
    "description",
    "price_amount",
    "currency",
    "billing_period",
    "trial_days",
    "enabled_modules",
    "limits",
    "is_active",
)


class PlanInUse(CodedAPIException):
    status_code = 409
    default_detail = "Schools are on this plan. Move them to another plan before retiring it."
    default_code = "plan_in_use"


def subscribable_plan(code: str) -> Plan:
    """The live, active plan ``code``, locked against a concurrent retire; else a 422.

    Every write that puts a school on a plan goes through here, which is how a
    `tenants.current_plan` value always names a real plan (no foreign key can: ADR-0013).
    """
    plan = (
        Plan.objects.select_for_update()
        .filter(code=code, deleted_at__isnull=True, is_active=True)
        .first()
    )
    if plan is None:
        raise DomainRuleViolation({"plan_code": "No active plan has this code."})
    return plan


def create_plan(*, data: dict, actor_id: uuid.UUID | None) -> Plan:
    try:
        with transaction.atomic():
            return Plan.objects.create(**data, created_by=actor_id, updated_by=actor_id)
    except IntegrityError as exc:
        # Two creates racing for one code: the unique index refuses the second.
        raise serializers.ValidationError({"code": [CODE_TAKEN]}) from exc


@transaction.atomic
def update_plan(plan: Plan, *, data: dict, actor_id: uuid.UUID | None) -> Plan:
    """Change the editable fields in ``data``; module access follows at once.

    Existing subscribers see the new modules and limits on their next request: plans are not
    versioned yet, so there is no grandfathering (deferred-work.md).
    """
    locked = Plan.objects.select_for_update().get(pk=plan.pk)
    fields = [field for field in EDITABLE_FIELDS if field in data]
    for field in fields:
        setattr(locked, field, data[field])
    locked.updated_by = actor_id
    locked.save(update_fields=[*fields, "updated_by", "updated_at"])
    if "enabled_modules" in fields:
        invalidate_feature_cache()
    return locked


@transaction.atomic
def delete_plan(plan: Plan, *, actor_id: uuid.UUID | None) -> Plan:
    """Retire ``plan``: soft-deleted and inactive. Refused (409) while any school is on it.

    The plan row is locked first, and `subscribable_plan` takes the same lock, so a school
    cannot join the plan between the check and the delete.
    """
    locked = Plan.objects.select_for_update().get(pk=plan.pk)
    if Tenant.objects.filter(current_plan=locked.code).exists():
        raise PlanInUse()
    locked.deleted_at = timezone.now()
    locked.is_active = False
    locked.updated_by = actor_id
    locked.save(update_fields=["deleted_at", "is_active", "updated_by", "updated_at"])
    return locked
