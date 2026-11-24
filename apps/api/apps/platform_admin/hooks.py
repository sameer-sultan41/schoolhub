"""Every hook the platform console plugs into ``core`` (ADR-0013), registered from ``ready()``.

``core`` never imports this app, so each seam it offers is filled here, in one place:
- the `owner` invitation's eligibility check (ADR-0033);
- the subscription state `:reinstate` follows (`core.tenancy.subscription_state`);
- the plan step of feature resolution (`core.tenancy.features.register_plan_resolver`);
- quotas (`core.tenancy.quotas`): the limits, the usage counters (the one implementation, in
  `usage.services`; storage in bytes) and the threshold notice.

A later PR adds the impersonation-grant checker to this same function.
"""

from __future__ import annotations


def register() -> None:
    # Imported here, not at module level: `ready()` is the first moment models may load. The
    # services import the lifecycle, which imports `notifications` and so registers its
    # triggers before any request can send one.
    from apps.platform_admin.subscriptions.services import (
        effective_limits,
        live_subscription_state,
        plan_modules,
    )
    from apps.platform_admin.tenants.services import owner_invitation_eligible
    from apps.platform_admin.usage.quotas import threshold_reached
    from apps.platform_admin.usage.services import count_staff, count_storage_bytes, count_students
    from core.rbac.invitations.eligibility import register_invitation_eligibility
    from core.rbac.models import InvitationKind
    from core.tenancy.features import register_plan_resolver
    from core.tenancy.quotas import (
        BYTES_PER_GB,
        register_quota_resolver,
        register_threshold_listener,
        register_usage_counter,
    )
    from core.tenancy.subscription_state import register_subscription_state

    register_invitation_eligibility(InvitationKind.OWNER, owner_invitation_eligible)
    register_subscription_state(live_subscription_state)
    register_plan_resolver(plan_modules)
    # `effective_limits` rebinds the school it is given: `check_quota` calls it only with that
    # school already bound.
    register_quota_resolver(effective_limits)
    register_threshold_listener(threshold_reached)
    # The one implementation of each counter (`usage.services`); storage counts in bytes, so
    # the check compares whole numbers against the GiB limit.
    register_usage_counter("students", count_students)
    register_usage_counter("staff", count_staff)
    register_usage_counter("storage_gb", count_storage_bytes, unit=BYTES_PER_GB)
