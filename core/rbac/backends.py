"""Authentication backend.

Two things make this non-default. Students are often issued a school username
rather than an email, so one identifier field must resolve against either. And an
email is unique only *within* a tenant — the same parent may hold accounts at two
schools (see multi-tenancy.md §1) — so an identifier can legitimately match more
than one account and the backend has to say which school it means.
"""

from __future__ import annotations

from django.contrib.auth.backends import ModelBackend
from django.db.models import Q

from core.rbac.models import User


class AmbiguousPrincipal(Exception):
    """The credentials are valid at more than one school, so the caller must choose.

    Raised only after the password has already matched, so it reveals nothing to
    someone who does not hold the credentials.
    """


class IdentifierBackend(ModelBackend):
    """Authenticate against email or school-issued username, scoped to a tenant."""

    def authenticate(
        self,
        request,
        username=None,
        password=None,
        tenant_slug: str | None = None,
        **kwargs,
    ):
        identifier = username or kwargs.get("identifier")
        if not identifier or not password:
            return None

        candidates = User.objects.filter(
            Q(email__iexact=identifier) | Q(username=identifier),
            deleted_at__isnull=True,
        ).select_related("tenant")

        if tenant_slug:
            candidates = candidates.filter(tenant__slug=tenant_slug)

        matched = [
            user
            for user in candidates
            if user.check_password(password) and self.user_can_authenticate(user)
        ]

        if not matched:
            # Hash anyway so a missing account and a wrong password take comparable
            # time; otherwise response timing enumerates who has an account.
            User().set_password(password)
            return None

        if len(matched) > 1:
            raise AmbiguousPrincipal("These credentials are valid at more than one school.")

        return matched[0]

    def user_can_authenticate(self, user) -> bool:
        return bool(user.is_active and user.deleted_at is None)
