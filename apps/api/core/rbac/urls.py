"""Authentication routes.

Mounted under /api/v1/ by config/api_v1.py. These paths are listed in
TenantMiddleware.EXEMPT_PREFIXES because they must work before a tenant is resolved.
"""

from django.urls import path

from core.rbac.views import (
    ChangePasswordView,
    LoginView,
    LogoutView,
    MeView,
    RefreshView,
)

app_name = "rbac"

urlpatterns = [
    path("auth/login", LoginView.as_view(), name="login"),
    path("auth/refresh", RefreshView.as_view(), name="refresh"),
    path("auth/logout", LogoutView.as_view(), name="logout"),
    path("auth/me", MeView.as_view(), name="me"),
    path("auth/change-password", ChangePasswordView.as_view(), name="change-password"),
]
