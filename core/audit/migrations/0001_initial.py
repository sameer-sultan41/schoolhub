import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models

# The audit trail is only trustworthy if the application cannot rewrite history, so
# UPDATE and DELETE are revoked at the database level rather than relying on the
# model's Python-side guard alone.
REVOKE_MUTATIONS = """
REVOKE UPDATE, DELETE ON TABLE audit_logs FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolhub_app') THEN
        REVOKE UPDATE, DELETE ON TABLE audit_logs FROM schoolhub_app;
    END IF;
END
$$;
"""

RESTORE_MUTATIONS = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolhub_app') THEN
        GRANT UPDATE, DELETE ON TABLE audit_logs TO schoolhub_app;
    END IF;
END
$$;
"""


class Migration(migrations.Migration):
    initial = True

    dependencies = [
        ("tenancy", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="AuditLog",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True,
                                        serialize=False)),
                ("impersonated_by", models.UUIDField(
                    blank=True, help_text="Platform user acting as the actor, if any.", null=True
                )),
                ("action", models.CharField(db_index=True, max_length=40)),
                ("resource_type", models.CharField(db_index=True, max_length=100)),
                ("resource_id", models.UUIDField(blank=True, db_index=True, null=True)),
                ("before", models.JSONField(blank=True, null=True)),
                ("after", models.JSONField(blank=True, null=True)),
                ("request_id", models.CharField(blank=True, db_index=True, max_length=64)),
                ("ip_address", models.GenericIPAddressField(blank=True, null=True)),
                ("user_agent", models.CharField(blank=True, max_length=400)),
                ("created_at", models.DateTimeField(auto_now_add=True, db_index=True)),
                ("actor", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.SET_NULL,
                    related_name="+", to=settings.AUTH_USER_MODEL,
                )),
                ("tenant", models.ForeignKey(
                    blank=True, null=True,
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name="+", to="tenancy.tenant",
                )),
            ],
            options={"db_table": "audit_logs", "ordering": ["-created_at"]},
        ),
        migrations.AddIndex(
            model_name="auditlog",
            index=models.Index(fields=["tenant", "-created_at"],
                               name="audit_logs_tenant_created_idx"),
        ),
        migrations.AddIndex(
            model_name="auditlog",
            index=models.Index(fields=["resource_type", "resource_id", "-created_at"],
                               name="audit_logs_resource_idx"),
        ),
        migrations.RunSQL(sql=REVOKE_MUTATIONS, reverse_sql=RESTORE_MUTATIONS),
    ]
