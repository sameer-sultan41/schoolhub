from django.apps import AppConfig


class FeesFinanceConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.fees_finance"
    label = "fees_finance"
    verbose_name = "Fees & Finance"

    def ready(self) -> None:
        # `core` never imports an app (ADR-0013), so the gateway credentials this app
        # stores are handed to `rotate_integration_credentials` from here.
        from apps.fees_finance.services import rotate_gateway_credentials
        from core.integrations.crypto import register_rotator

        register_rotator(rotate_gateway_credentials)
