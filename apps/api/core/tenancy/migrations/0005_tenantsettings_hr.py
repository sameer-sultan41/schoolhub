from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("tenancy", "0004_rls_policies"),
    ]

    operations = [
        migrations.AddField(
            model_name="tenantsettings",
            name="hr",
            field=models.JSONField(
                blank=True,
                default=dict,
                help_text=(
                    "HR/staff config, e.g. employee_number_pattern, "
                    "staff_document_types. A dedicated namespace rather than "
                    "folding into `academic` — later HR/leave and payroll "
                    "modules (Tier 3/6) have a home here too."
                ),
            ),
        ),
    ]
