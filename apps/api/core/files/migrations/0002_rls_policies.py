from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [
        ("files", "0001_initial"),
    ]

    operations = [
        *rls_operations("files"),
    ]
