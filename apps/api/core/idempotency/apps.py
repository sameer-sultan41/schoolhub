from django.apps import AppConfig


class IdempotencyConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.idempotency"
    label = "idempotency"
    verbose_name = "Idempotency"
