from django.apps import AppConfig
from django.db.models.signals import post_migrate


class WebsiteCmsConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.website_cms"
    label = "website_cms"
    verbose_name = "Website & CMS"

    def ready(self) -> None:
        from apps.website_cms.themes import sync_themes_on_migrate

        # Code-declared themes sync into `themes` after every migrate, so a theme edit
        # needs no data migration (module doc §5.10), like core.tenancy's feature flags.
        post_migrate.connect(sync_themes_on_migrate, sender=self)
