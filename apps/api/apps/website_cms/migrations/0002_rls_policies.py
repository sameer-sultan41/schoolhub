"""Enable Row-Level Security on every tenant-owned table this module owns.

`themes` is platform scope (no tenant_id) and deliberately has no policy.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("website_cms", "0001_initial")]
    operations = [
        *rls_operations(
            "website_settings", "website_pages", "page_sections", "navigation_menus", "seo_settings"
        ),
    ]
