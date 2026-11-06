"""Permission keys for the parent portal — docs/03-modules/parent-portal.md §4.

The portal owns no records: every card reads its module's own key, so this is the
one key that admits a caller to the portal shell and its dashboard summary.
"""

from core.rbac.registry import registry
from core.rbac.roles import PORTAL_ROLES

DASHBOARD_VIEW = "parent-portal.dashboard.view"

registry.register(
    DASHBOARD_VIEW,
    "Access the portal shell and per-child dashboard.",
    PORTAL_ROLES,
)
