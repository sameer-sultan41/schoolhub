"""``BlockingDestroyMixin`` — the one piece of school-organization's original
flat HTTP layer still at the app root.

Every ViewSet and APIView that used to live in this file has moved into its
own resource package (``campuses/``, ``departments/``, ``academic_sessions/``,
``terms/``, ``classes/``, ``sections/``, ``subjects/``, ``houses/``,
``school_settings/``, ``holiday_calendar/``). This mixin stays here, at this
exact path and under this exact name, because ``apps/academics/views.py``
imports it directly (``from apps.school_organization.views import
BlockingDestroyMixin``) — the same kind of cross-app constraint that keeps
parts of ``services.py`` at the module root; see that file's docstring for
the full picture of what stays flat in this module and why.

Every one of those moved ViewSets/APIViews still declares
``required_permission``/``required_permission_map`` on itself, in its own
package — that requirement doesn't live in this file any more, but it hasn't
gone away: ``HasPermissionKey`` fails closed when one is missing, so an
undeclared endpoint is a 403, not an open door. An 11th resource package
needs one too.
"""

from __future__ import annotations

from apps.school_organization import services
from core.api.viewsets import TenantScopedViewSetMixin


class BlockingDestroyMixin(TenantScopedViewSetMixin):
    """Refuse to delete a structural record that other records still point at (§11).

    The PROTECT foreign keys would stop it anyway, but as an integrity error with
    no useful message; this turns it into a 422 naming the blocking relations.
    """

    def perform_destroy(self, instance) -> None:
        services.assert_deletable(instance)
        super().perform_destroy(instance)
