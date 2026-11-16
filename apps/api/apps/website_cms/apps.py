from django.apps import AppConfig
from django.db.models.signals import post_delete, post_migrate, post_save


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

        from apps.website_cms.visibility import register_providers

        # Tell core.files which files published website content keeps public (ADR-0013).
        register_providers()

        from apps.website_cms.signals import revalidate_on_module_flag_change
        from core.tenancy.models import TenantFeatureOverride

        # `module.website` switched for a tenant: drop its cached site and `by-host` status.
        post_save.connect(
            revalidate_on_module_flag_change,
            sender=TenantFeatureOverride,
            dispatch_uid="website_cms.module_flag_saved",
        )
        post_delete.connect(
            revalidate_on_module_flag_change,
            sender=TenantFeatureOverride,
            dispatch_uid="website_cms.module_flag_deleted",
        )

        from corsheaders.signals import check_request_enabled

        from apps.website_cms.cors import allow_tenant_origin

        # Tenant sites (custom domains too) are not enumerable in settings: let a school's own
        # origin call the public API, on top of `CORS_ALLOWED_ORIGINS`.
        check_request_enabled.connect(allow_tenant_origin, dispatch_uid="website_cms.cors")
