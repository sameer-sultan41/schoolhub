"""The base for unauthenticated endpoints reached from an emailed link (ADR-0033)."""

from __future__ import annotations

from rest_framework.permissions import AllowAny
from rest_framework.views import APIView

from core.api.exceptions import InvalidLink
from core.api.throttling import PasswordResetEmailThrottle, PasswordResetIPThrottle
from core.rbac.account_links import tenant_for_slug
from core.tenancy.models import Tenant


class EmailedLinkView(APIView):
    """``AllowAny`` plus throttles, like ``LoginView``, but tenant-bound.

    ``TenantMiddleware`` binds nothing for an anonymous caller, so the view resolves the
    body's ``school`` and runs every lookup inside ``tenant_context(tenant.id)``.
    """

    permission_classes = [AllowAny]
    throttle_classes = [PasswordResetIPThrottle, PasswordResetEmailThrottle]

    def link_tenant(self, request, slug: str) -> Tenant:
        """The school the link names; an unknown one is the same 400 as a bad token."""
        tenant = tenant_for_slug(slug)
        if tenant is None:
            raise InvalidLink()
        return tenant
