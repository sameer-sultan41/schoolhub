"""Shared view-layer surface for the website module.

Kept at the app root: every resource package's viewsets use these.
"""

from __future__ import annotations

from rest_framework.permissions import IsAuthenticated

from apps.website_cms.features import FEATURE
from core.api.permissions import RequiresModuleFeature
from core.rbac.permissions import DenyRestrictedPrincipals, HasPermissionKey

__all__ = ["FEATURE", "STAFF_PERMISSIONS"]

STAFF_PERMISSIONS = [
    IsAuthenticated,
    RequiresModuleFeature,
    HasPermissionKey,
    DenyRestrictedPrincipals,
]
