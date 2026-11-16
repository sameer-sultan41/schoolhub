"""Constants of the platform console (docs/03-modules/platform-admin.md)."""

# The resources of the console's `platform.<resource>.<action>` keys (§4). Every key on one of
# them is platform-scope. The tenant-side `platform.file`, `platform.job` and
# `platform.notification` keys share the module name only (ADR-0036).
PLATFORM_RESOURCES = ("tenant", "plan", "subscription", "feature-flag", "migration", "report")
