import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):
    initial = True

    dependencies = []

    operations = [
        migrations.CreateModel(
            name="Tenant",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True,
                                        serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.UUIDField(blank=True, editable=False, null=True)),
                ("updated_by", models.UUIDField(blank=True, editable=False, null=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("name", models.CharField(max_length=200)),
                ("slug", models.SlugField(help_text="Wildcard subdomain label.", max_length=63,
                                          unique=True)),
                ("status", models.CharField(
                    choices=[
                        ("provisioning", "Provisioning"),
                        ("trial", "Trial"),
                        ("active", "Active"),
                        ("past_due", "Past due"),
                        ("suspended", "Suspended"),
                        ("deprovisioned", "Deprovisioned"),
                    ],
                    default="provisioning",
                    max_length=20,
                )),
                ("timezone", models.CharField(default="UTC", max_length=64)),
                ("locale", models.CharField(default="en", max_length=10)),
                ("currency", models.CharField(default="USD", max_length=3)),
                ("trial_ends_at", models.DateTimeField(blank=True, null=True)),
                ("suspended_at", models.DateTimeField(blank=True, null=True)),
            ],
            options={"db_table": "tenants", "ordering": ["name"]},
        ),
        migrations.CreateModel(
            name="TenantSettings",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True,
                                        serialize=False)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("created_by", models.UUIDField(blank=True, editable=False, null=True)),
                ("updated_by", models.UUIDField(blank=True, editable=False, null=True)),
                ("deleted_at", models.DateTimeField(blank=True, db_index=True, null=True)),
                ("branding", models.JSONField(blank=True, default=dict)),
                ("academic", models.JSONField(blank=True, default=dict)),
                ("features", models.JSONField(blank=True, default=dict)),
                ("tenant", models.OneToOneField(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="settings",
                    to="tenancy.tenant",
                )),
            ],
            options={"db_table": "tenant_settings"},
        ),
    ]
