"""Shared view-layer surface for the timetable module.

Deliberately kept at the app root — see ``services.py``'s module docstring
for the general shape of this rule. All three constants here are used by
every viewset in every one of the four resource packages (``rooms/``,
``periods/``, ``slots/``, ``substitutions/`` — docs/03-modules/timetable.md
§20):

- ``FEATURE`` — the ``required_feature`` every viewset declares.
- ``STAFF_PERMISSIONS`` — the shared ``permission_classes`` stack.
- ``SCAFFOLDING_VIEW_KEY`` — §4 declares no ``timetable.period.view`` /
  ``timetable.room.view``; reading either list falls under the timetable
  view key instead (academics' curriculum viewset is in the same position
  and resolves it the same way).
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated

from core.api.permissions import RequiresModuleFeature
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey

FEATURE = "module.timetable"

STAFF_PERMISSIONS = [
    IsAuthenticated,
    RequiresModuleFeature,
    HasPermissionKey,
    DenyRestrictedPrincipals,
]

# §4 declares no `timetable.period.view` / `timetable.room.view`; see the module
# docstring for why reading both falls under the timetable view key.
SCAFFOLDING_VIEW_KEY = "timetable.timetable.view"
