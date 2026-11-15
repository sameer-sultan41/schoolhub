from django.apps import AppConfig


class AIConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.ai"
    label = "ai"
    verbose_name = "AI Gateway"

    def ready(self) -> None:
        from core.ai.registry import load_module_ai

        # Every installed app's own ai.py self-registers its features, the way
        # load_module_permissions and load_module_features fill their registries.
        load_module_ai()
