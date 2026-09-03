from django.apps import AppConfig


class JobsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.jobs"
    label = "jobs"
    verbose_name = "Background Jobs"
