"""DRF `permission_classes` lists and the module feature flag, shared across
every resource package in this module.

Deliberately not `permissions.py` — that file already means something
different here (the RBAC role-tuples `core/rbac/registry.py` reads at
provisioning time, per its own docstring). `FEATURE` was previously an
independent literal duplicated in both the old `views.py` and `services.py`;
this is its one definition now.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated

from core.api.permissions import RequiresModuleFeature
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey

FEATURE = "module.communication"

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
