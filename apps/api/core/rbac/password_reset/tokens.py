"""The reset-link token: Django's documented generator under this platform's own salt.

The token is an HMAC over the user's id, password hash, last login and email, so it dies
the moment the password changes (single use) or after ``PASSWORD_RESET_TIMEOUT`` (one
hour). The salt keeps these tokens from validating anywhere else the default generator
is used.
"""

from __future__ import annotations

from django.contrib.auth.tokens import PasswordResetTokenGenerator


class ResetTokenGenerator(PasswordResetTokenGenerator):
    key_salt = "schoolhub.password-reset"


reset_token_generator = ResetTokenGenerator()
