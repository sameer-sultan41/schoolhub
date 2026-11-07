"""The gateway-wide kill switch.

On by default, platform-wide: a kill switch can only ever be forced *off* by a
tenant override or by ops (``core.tenancy.features.is_feature_enabled``), so a
default-off one could never be turned on. Each AI feature carries its own flag,
default off, which is the per-tenant opt-in (ai-governance.md §1.7, §7.5).
"""

from core.tenancy.features import registry

GATEWAY_FLAG = registry.register(
    "ai.gateway",
    "Every AI feature on the platform. Turn off to stop all AI calls for a school.",
    default_enabled=True,
    is_kill_switch=True,
).key
