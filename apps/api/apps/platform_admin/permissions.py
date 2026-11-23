"""Permission keys of the platform console — docs/03-modules/platform-admin.md §4.

Every key is platform-scope (ADR-0036): only `platform_super_admin` and `platform_support`
hold them, and no school's role ever can.
"""

from core.rbac.registry import registry

SUPER_ADMIN = ("platform_super_admin",)
BOTH = ("platform_super_admin", "platform_support")

for key, description, roles in (
    ("platform.tenant.view", "View tenant list, detail, health, usage.", BOTH),
    ("platform.tenant.provision", "Create and provision a tenant.", SUPER_ADMIN),
    ("platform.tenant.update", "Edit a tenant record and its lifecycle metadata.", SUPER_ADMIN),
    ("platform.tenant.suspend", "Suspend a tenant.", SUPER_ADMIN),
    ("platform.tenant.reinstate", "Reinstate a suspended tenant.", SUPER_ADMIN),
    ("platform.tenant.export", "Trigger a full tenant data export.", SUPER_ADMIN),
    ("platform.tenant.delete", "Start deprovisioning (retention, then purge).", SUPER_ADMIN),
    ("platform.tenant.impersonate", "Time-boxed, reason-required impersonation.", BOTH),
    ("platform.plan.view", "View the plan catalog.", BOTH),
    ("platform.plan.create", "Create a plan.", SUPER_ADMIN),
    ("platform.plan.update", "Edit a plan.", SUPER_ADMIN),
    ("platform.plan.delete", "Retire a plan.", SUPER_ADMIN),
    ("platform.subscription.view", "View tenant subscriptions and billing state.", BOTH),
    ("platform.subscription.update", "Manage tenant subscriptions and billing.", SUPER_ADMIN),
    ("platform.feature-flag.view", "View flag defaults and per-tenant overrides.", BOTH),
    ("platform.feature-flag.update", "Change flag defaults and per-tenant overrides.", SUPER_ADMIN),
    ("platform.migration.import", "Run legacy-data imports into a tenant.", SUPER_ADMIN),
    ("platform.report.view", "Platform aggregate reporting.", BOTH),
):
    registry.register(key, description, roles, scope="platform")
