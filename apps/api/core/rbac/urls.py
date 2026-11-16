"""Authentication routes.

Mounted under /api/v1/ by config/api_v1.py. These paths are listed in
TenantMiddleware.EXEMPT_PREFIXES because they must work before a tenant is resolved.
"""

from django.urls import path

from core.rbac.invitations.views import InvitationAcceptView, InvitationPreviewView
from core.rbac.password_reset.views import PasswordResetConfirmView, PasswordResetView
from core.rbac.views import (
    ChangePasswordView,
    LoginView,
    LogoutView,
    MeView,
    MfaConfirmView,
    MfaDisableView,
    MfaEnrollView,
    MfaVerifyView,
    RefreshView,
)

app_name = "rbac"

urlpatterns = [
    path("auth/login", LoginView.as_view(), name="login"),
    path("auth/refresh", RefreshView.as_view(), name="refresh"),
    path("auth/logout", LogoutView.as_view(), name="logout"),
    path("auth/me", MeView.as_view(), name="me"),
    path("auth/change-password", ChangePasswordView.as_view(), name="change-password"),
    # TOTP MFA (core/rbac/mfa.py): :verify completes a challenged login; the rest are enrolment.
    path("auth/mfa:verify", MfaVerifyView.as_view(), name="mfa-verify"),
    path("auth/mfa:enroll", MfaEnrollView.as_view(), name="mfa-enroll"),
    path("auth/mfa:confirm", MfaConfirmView.as_view(), name="mfa-confirm"),
    path("auth/mfa:disable", MfaDisableView.as_view(), name="mfa-disable"),
    # Reached from an emailed link, unauthenticated; the body names the school (ADR-0033).
    path("auth/invitations:preview", InvitationPreviewView.as_view(), name="invitation-preview"),
    path("auth/invitations:accept", InvitationAcceptView.as_view(), name="invitation-accept"),
    path("auth/password-reset", PasswordResetView.as_view(), name="password-reset"),
    path(
        "auth/password-reset:confirm",
        PasswordResetConfirmView.as_view(),
        name="password-reset-confirm",
    ),
]
