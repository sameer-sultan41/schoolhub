"""Tenant isolation for the invoicing tables.

No `append_only_operations` here: none of these five are append-only. An
invoice's totals move as payments arrive, a fine moves from pending to invoiced,
and a grant is revoked — all legitimate updates. `ledger_entries` remains the
only table on the platform whose mutation grants are revoked, and the reason is
in its own model docstring: money *postings* are the immutable record, while the
documents that produce them have lifecycles.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("fees_finance", "0003_invoicing")]

    operations = [
        *rls_operations(
            "discounts",
            "scholarships",
            "fines",
            "fee_invoices",
            "fee_invoice_lines",
        ),
    ]
