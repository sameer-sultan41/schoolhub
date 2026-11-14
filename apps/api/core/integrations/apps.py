from django.apps import AppConfig


class IntegrationsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.integrations"
    label = "integrations"
    verbose_name = "Integrations"

    def ready(self) -> None:
        from core.integrations.payments.fake import FakeAdapter
        from core.integrations.payments.registry import register_adapter

        register_adapter(FakeAdapter())
