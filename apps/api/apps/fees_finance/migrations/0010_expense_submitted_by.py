from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("fees_finance", "0009_alter_expense_status"),
    ]

    operations = [
        migrations.AddField(
            model_name="expense",
            name="submitted_by",
            field=models.UUIDField(
                blank=True,
                help_text=(
                    "Who moved the draft into the approval queue; may differ from created_by."
                ),
                null=True,
            ),
        ),
    ]
