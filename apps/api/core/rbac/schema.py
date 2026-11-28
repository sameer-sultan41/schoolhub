"""OpenAPI extensions for core.rbac, imported by `RbacConfig.ready()`."""

from __future__ import annotations

from drf_spectacular.contrib.rest_framework_simplejwt import SimpleJWTScheme


class ImpersonationAwareJWTScheme(SimpleJWTScheme):
    """The same ``jwtAuth`` bearer scheme as SimpleJWT's own class, for its subclass."""

    target_class = "core.rbac.authentication.ImpersonationAwareJWTAuthentication"
