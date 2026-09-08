"""Tenant isolation for the fee-configuration and ledger tables, plus the
append-only grants that make `ledger_entries` a ledger rather than a log.

Two operations, and the order matters. `rls_operations` enables and FORCEs
row-level security on all five tables — without it `tests/test_rls_coverage.py`
fails the build, and `LedgerEntry` is caught by that check because
`tenant_owned_tables()` enumerates `TenantScopedModel`, the base both
`TenantOwnedModel` and `AppendOnlyTenantModel` share.

`append_only_operations` then revokes UPDATE and DELETE on `ledger_entries` from
PUBLIC and from `schoolhub_app`, and grants back UPDATE on exactly one column.
`reversed_by_transaction_id` is stamped on the original lines when a reversal
supersedes them, and a column-level grant is the honest way to allow that: an
ordinary `save()` writes every column and PostgreSQL still refuses it, while
`save(update_fields=["reversed_by_transaction_id"])` gets through. Which columns
are mutable is therefore a database fact, not a convention, and
`tests/test_append_only_coverage.py` fails the build if this list and
`LedgerEntry.MUTABLE_FIELDS` ever disagree.
"""

from django.db import migrations

from core.tenancy.grants import append_only_operations
from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("fees_finance", "0001_initial")]

    operations = [
        *rls_operations(
            "ledger_accounts",
            "ledger_entries",
            "fee_heads",
            "fee_structures",
            "fee_schedules",
        ),
        *append_only_operations(
            "ledger_entries",
            mutable_columns={"ledger_entries": ["reversed_by_transaction_id"]},
        ),
    ]
