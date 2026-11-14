"""Ending a user's signed-in sessions.

simplejwt 5.5.1 writes an ``OutstandingToken`` row for every refresh token it issues:
``RefreshToken.for_user`` at login, and ``TokenRefreshSerializer`` calls ``outstand()``
on the rotated token (``ROTATE_REFRESH_TOKENS=True``). Blacklisting a user's outstanding
rows therefore covers the token they hold now, however many times it has rotated
(ADR-0033). Access tokens cannot be blacklisted; they live 15 minutes, and
``JWTAuthentication`` refuses an inactive user on every request.
"""

from __future__ import annotations

import uuid

from django.utils import timezone
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken


def revoke_refresh_tokens(user_id: uuid.UUID) -> None:
    """Blacklist every unexpired refresh token issued to ``user_id``."""
    live = OutstandingToken.objects.filter(
        user_id=user_id,
        expires_at__gt=timezone.now(),
        blacklistedtoken__isnull=True,
    )
    BlacklistedToken.objects.bulk_create(
        [BlacklistedToken(token=token) for token in live], ignore_conflicts=True
    )
