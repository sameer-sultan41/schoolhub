"""Feature flag owned by the school-organization module.

Unlike every module that ships after it, this one defaults ON: the module was
already live for every tenant before RequiresModuleFeature existed, and Phase-2
DoD's "default off for real tenants" rule is about new modules arriving behind a
flag, not about retroactively hiding a shipped one. Flip it off per tenant (a
TenantFeatureOverride) if a specific school genuinely should not have it —
`module.school` is not a kill switch, so that stays possible.
"""

from core.tenancy.features import registry

registry.register(
    "module.school",
    "School & organization structure (campuses, sessions, classes, sections, subjects, houses).",
    default_enabled=True,
)
