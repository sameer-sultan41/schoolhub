from django.apps import AppConfig


class RbacConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.rbac"
    label = "rbac"
    verbose_name = "Authentication & RBAC"

    def ready(self) -> None:
        # Register permission-cache invalidation and load every module's permission keys.
        from core.rbac import signals  # noqa: F401
        from core.rbac.registry import load_module_permissions

        load_module_permissions()
