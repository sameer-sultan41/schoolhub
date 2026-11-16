from django.apps import AppConfig
from django.db.models.signals import post_migrate


class RbacConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.rbac"
    label = "rbac"
    verbose_name = "Authentication & RBAC"

    def ready(self) -> None:
        # Register permission-cache invalidation and load every module's keys.
        from core.integrations.crypto import register_global_rotator
        from core.rbac import signals  # noqa: F401
        from core.rbac.mfa import rotate_mfa_secrets
        from core.rbac.registry import load_module_permissions
        from core.rbac.sync import sync_rbac_on_migrate

        load_module_permissions()

        # TOTP secrets are encrypted with the integration keys; `users` has no RLS, so they
        # rotate once per run, not per tenant.
        register_global_rotator(rotate_mfa_secrets)

        # Keeps the permissions table, and every default role, in step with the registry on
        # every migrate, the same way Django maintains content types.
        post_migrate.connect(sync_rbac_on_migrate, sender=self)
