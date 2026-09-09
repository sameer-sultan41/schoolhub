from django.apps import AppConfig


class CommunicationConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.communication"
    label = "communication"
    verbose_name = "Communication"

    def ready(self) -> None:
        # core/notifications must not import a Tier-4 app, so the wiring runs the
        # other way: communication plugs its resolvers in here, once, at
        # app-ready. See core/notifications/templates.py's and services.py's own
        # docstrings for what "no resolver registered" means to every caller that
        # existed before this module did.
        from apps.communication.services import bulk_is_channel_enabled
        from apps.communication.templates_service import resolve_tenant_template
        from core.notifications import services as core_notification_services
        from core.notifications import templates as core_notification_templates

        core_notification_templates.set_override_resolver(resolve_tenant_template)
        core_notification_services.set_preference_resolver(bulk_is_channel_enabled)

        from apps.communication import signals  # noqa: F401
