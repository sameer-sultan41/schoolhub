"""Tenant isolation for the spend tables. The last of the module's policies.

With these three, all 19 of this module's tables carry a policy —
`tests/test_rls_coverage.py` derives that list from the models, so the check is
what proves it rather than this docstring.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("fees_finance", "0007_spend")]

    operations = [
        *rls_operations("expense_categories", "expenses", "budgets"),
    ]
