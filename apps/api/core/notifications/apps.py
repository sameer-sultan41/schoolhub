from django.apps import AppConfig


class NotificationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.notifications"
    label = "notifications"
    verbose_name = "Notifications"

    def ready(self) -> None:
        from core.notifications.templates import load_module_notifications

        # Each module's own notifications.py registers its triggers and platform
        # default templates, mirroring load_module_permissions (core.rbac) and
        # load_module_features (core.tenancy). Nothing syncs to the database:
        # platform defaults are code, and the tenant-override table belongs to
        # the communication module.
        load_module_notifications()
