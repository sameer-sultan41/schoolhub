from django.apps import AppConfig
from django.db.models.signals import post_migrate


class RbacConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.rbac"
    label = "rbac"
    verbose_name = "Authentication & RBAC"

    def ready(self) -> None:
        # Register permission-cache invalidation and load every module's keys.
        from core.rbac import signals  # noqa: F401
        from core.rbac.registry import load_module_permissions
        from core.rbac.sync import sync_permissions_on_migrate

        load_module_permissions()

        # Keeps the permissions table in step with the registry on every migrate,
        # the same way Django maintains content types.
        post_migrate.connect(sync_permissions_on_migrate, sender=self)
