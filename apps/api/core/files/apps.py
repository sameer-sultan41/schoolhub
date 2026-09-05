from django.apps import AppConfig


class FilesConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "core.files"
    label = "files"
    verbose_name = "Files"

    def ready(self) -> None:
        from core.files.purposes import load_module_upload_purposes

        # Every installed app's own uploads.py self-registers into the registry,
        # mirroring core.rbac.registry's load_module_permissions and
        # core.tenancy.features' load_module_features. Nothing syncs to the
        # database here — upload purposes are pure code, with no row to seed.
        load_module_upload_purposes()
