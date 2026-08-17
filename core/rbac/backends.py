"""Authentication backend.

Students are often issued a school username rather than an email, so a single
identifier field must resolve against either. Lookups are case-insensitive on email
and constant-time on failure to avoid leaking which accounts exist.
"""

from __future__ import annotations

from django.contrib.auth.backends import ModelBackend
from django.db.models import Q

from core.rbac.models import User


class IdentifierBackend(ModelBackend):
    """Authenticate against email or school-issued username."""

    def authenticate(self, request, username=None, password=None, **kwargs):
        identifier = username or kwargs.get("identifier")
        if not identifier or not password:
            return None

        user = (
            User.objects.filter(
                Q(email__iexact=identifier) | Q(username=identifier),
                deleted_at__isnull=True,
            )
            .order_by("id")
            .first()
        )

        if user is None:
            # Run the hasher anyway so a missing account and a wrong password take
            # comparable time — otherwise response timing enumerates accounts.
            User().set_password(password)
            return None

        if not user.check_password(password) or not self.user_can_authenticate(user):
            return None

        return user

    def user_can_authenticate(self, user) -> bool:
        return bool(user.is_active and user.deleted_at is None)
