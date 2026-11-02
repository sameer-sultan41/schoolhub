"""Add `results.processed_by`, backfilled from `created_by`.

The approval gate compared the approver with `created_by`, which names only the
first processing run; `processed_by` is re-stamped by every run. `created_by` is
the only processor stamp existing rows carry, so it is the backfill: right unless
someone else re-processed after a send-back, which left no trace to recover.
"""

from django.db import migrations, models
from django.db.models import F

from core.tenancy.context import TENANT_GUC


def backfill_processed_by(apps, schema_editor) -> None:
    """Copy `created_by` into a null `processed_by`, one tenant at a time.

    `results` has FORCE ROW LEVEL SECURITY, so even the table owner sees no rows
    without a tenant bound; each tenant is bound transaction-locally in turn and the
    caller's binding is restored afterwards.
    """
    from django.db import connection as default_connection

    connection = schema_editor.connection if schema_editor is not None else default_connection
    tenant_model = apps.get_model("tenancy", "Tenant")
    result_model = apps.get_model("examinations", "Result")
    with connection.cursor() as cursor:
        cursor.execute("SELECT current_setting(%s, true)", [TENANT_GUC])
        previous = cursor.fetchone()[0] or ""
        for tenant_id in tenant_model.objects.values_list("pk", flat=True):
            cursor.execute("SELECT set_config(%s, %s, true)", [TENANT_GUC, str(tenant_id)])
            result_model._base_manager.filter(
                tenant_id=tenant_id, processed_by__isnull=True
            ).update(processed_by=F("created_by"))
        cursor.execute("SELECT set_config(%s, %s, true)", [TENANT_GUC, previous])


class Migration(migrations.Migration):
    dependencies = [
        ("examinations", "0010_rls_policies"),
        ("tenancy", "0005_tenantsettings_hr"),
    ]

    operations = [
        migrations.AddField(
            model_name="result",
            name="processed_by",
            field=models.UUIDField(
                blank=True,
                help_text="users(id) of the latest processing run; re-stamped on every run.",
                null=True,
            ),
        ),
        migrations.AlterField(
            model_name="result",
            name="approved_by",
            field=models.UUIDField(
                blank=True, help_text="Must differ from `processed_by` (§4).", null=True
            ),
        ),
        # Reversing drops the column, so the data step has nothing to undo.
        migrations.RunPython(backfill_processed_by, migrations.RunPython.noop),
    ]
