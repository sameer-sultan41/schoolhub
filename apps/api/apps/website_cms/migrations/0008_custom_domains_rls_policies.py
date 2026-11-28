"""Enable Row-Level Security on custom_domains.

`custom_domain_routes` is platform scope (plan decision 7) and deliberately has no policy.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("website_cms", "0007_custom_domains")]
    operations = [*rls_operations("custom_domains")]
