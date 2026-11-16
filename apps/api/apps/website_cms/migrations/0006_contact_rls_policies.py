"""Enable Row-Level Security on contact_submissions."""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("website_cms", "0005_contact_submissions")]
    operations = [*rls_operations("contact_submissions")]
