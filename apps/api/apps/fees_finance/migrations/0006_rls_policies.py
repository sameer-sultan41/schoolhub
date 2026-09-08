"""Tenant isolation for the collection tables.

`voucher_settlement_rows` is not in §15's list and is added deliberately — see
`SettlementRow`'s docstring: §11 requires that a settlement row post at most
once, and a rule about what happens *at most once* needs somewhere to record
that it happened. It is tenant-owned like everything else here, so it gets a
policy like everything else here.

Still no `append_only_operations`: a payment moves from pending to confirmed, a
voucher from issued to paid, a refund through four states. `ledger_entries`
remains the one table whose mutation grants are revoked, because the *postings*
are the immutable record while the documents producing them have lifecycles.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("fees_finance", "0005_collection")]

    operations = [
        *rls_operations(
            "payments",
            "receipts",
            "refunds",
            "fee_vouchers",
            "voucher_collection_imports",
            "voucher_settlement_rows",
        ),
    ]
