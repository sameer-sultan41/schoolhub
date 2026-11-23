"""Every hook the platform console plugs into ``core`` (ADR-0013), registered from ``ready()``.

``core`` never imports this app, so each seam it offers is filled here, in one place:
- the `owner` invitation's eligibility check (ADR-0033);
- the subscription state `:reinstate` follows (`core.tenancy.subscription_state`);
- the plan step of feature resolution (`core.tenancy.features.register_plan_resolver`).

Later PRs add the quota resolver, the usage counters and the impersonation-grant checker to
this same function.
"""

from __future__ import annotations


def register() -> None:
    # Imported here, not at module level: `ready()` is the first moment models may load. The
    # services import the lifecycle, which imports `notifications` and so registers its
    # triggers before any request can send one.
    from apps.platform_admin.subscriptions.services import live_subscription_state, plan_modules
    from apps.platform_admin.tenants.services import owner_invitation_eligible
    from core.rbac.invitations.eligibility import register_invitation_eligibility
    from core.rbac.models import InvitationKind
    from core.tenancy.features import register_plan_resolver
    from core.tenancy.subscription_state import register_subscription_state

    register_invitation_eligibility(InvitationKind.OWNER, owner_invitation_eligible)
    register_subscription_state(live_subscription_state)
    register_plan_resolver(plan_modules)
