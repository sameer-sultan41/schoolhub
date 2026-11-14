# Joins two 0010s written in parallel: main's `expense_submitted_by` and the online-payments
# chain (0010-0012). They touch different tables, so there is nothing to reconcile.
from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("fees_finance", "0010_expense_submitted_by"),
        ("fees_finance", "0012_online_payment_fixes"),
    ]

    operations = []
