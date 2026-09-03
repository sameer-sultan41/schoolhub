from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [
        ("idempotency", "0001_initial"),
    ]

    operations = [
        *rls_operations("idempotency_records"),
    ]
