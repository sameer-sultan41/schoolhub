"""DRF `permission_classes` lists shared across every resource package in
this module.

Deliberately not `permissions.py` — that file already means something
different here (the RBAC role-tuples `core/rbac/registry.py` reads at
provisioning time, per its own docstring). `FEATURE` lives in `features.py`,
not here: a service function that only needs to gate on the flag (e.g.
`preferences/services/matrix.py`) would otherwise have to import this file
and, with it, the whole DRF permission stack — real coupling for a string
constant, and a module-level `apps.py:ready()` import chain worth avoiding.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated

from apps.communication.features import FEATURE
from core.api.permissions import RequiresModuleFeature
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey

__all__ = ["FEATURE", "OWN_PREFERENCE_PERMISSIONS", "STAFF_PERMISSIONS"]

# The delivery dashboard and template management are staff-only — §3 does not
# list guardians/students among this pair's users.
STAFF_PERMISSIONS = [
    IsAuthenticated,
    RequiresModuleFeature,
    HasPermissionKey,
    DenyRestrictedPrincipals,
]

# Every tenant role reaches `NotificationPreferenceView` — §4's "all roles
# (scope own)" — including guardians and students managing their own channels.
# Also used by `NoticeViewSet.get_permissions()` for the `acknowledge` action
# specifically, since guardians/students hold that key too.
OWN_PREFERENCE_PERMISSIONS = [IsAuthenticated, RequiresModuleFeature, HasPermissionKey]
