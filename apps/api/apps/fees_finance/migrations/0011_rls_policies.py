"""Tenant isolation for the two online-payment tables.

`payment_gateway_accounts` holds each school's encrypted merchant credentials. Fernet
ciphertext is not bound to a tenant (ADR-0034), so this policy is the boundary.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("fees_finance", "0010_online_payments")]

    operations = [
        *rls_operations("payment_gateway_accounts", "gateway_reconciliation_issues"),
    ]
