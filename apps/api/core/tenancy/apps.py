from django.apps import AppConfig
from django.db.models.signals import post_migrate


class TenancyConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.tenancy"
    label = "tenancy"
    verbose_name = "Tenancy"

    def ready(self) -> None:
        import core.tenancy.signals  # noqa: F401  (registers the cache-eviction receivers)
        from core.tenancy.features import load_module_features, sync_feature_flags_on_migrate

        # Every installed app's own features.py self-registers into the registry
        # before post_migrate fires, mirroring core.rbac.registry's
        # load_module_permissions — same reason: the registry must be complete
        # before the sync receiver upserts it into the database.
        load_module_features()
        post_migrate.connect(sync_feature_flags_on_migrate, sender=self)
