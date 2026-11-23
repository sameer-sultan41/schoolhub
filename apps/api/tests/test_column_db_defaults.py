"""NOT NULL columns added in this release carry a database default (infra/AGENTS.md rule 6).

The previous release keeps running on the migrated schema during a deploy, and its inserts
name none of these columns; without a database default each insert fails on NOT NULL.
"""

from __future__ import annotations

from django.db import connection
from django.test import TestCase

COLUMNS = (
    ("users", "mfa_failed_attempts"),
    ("roles", "is_platform"),
    ("permissions", "scope"),
    ("tenants", "contact_name"),
    ("tenants", "contact_email"),
    ("tenants", "contact_phone"),
    ("tenants", "current_plan"),
    ("tenants", "subscription_status"),
    ("tenants", "billing_provider_ref"),
    ("tenant_settings", "onboarding"),
)


class ColumnDbDefaultTests(TestCase):
    def test_new_not_null_columns_have_a_database_default(self) -> None:
        with connection.cursor() as cursor:
            for table, column in COLUMNS:
                with self.subTest(table=table, column=column):
                    cursor.execute(
                        "SELECT is_nullable, column_default FROM information_schema.columns "
                        "WHERE table_name = %s AND column_name = %s",
                        [table, column],
                    )
                    row = cursor.fetchone()
                    assert row is not None, f"{table}.{column} does not exist"
                    nullable, default = row
                    self.assertEqual(nullable, "NO")
                    self.assertIsNotNone(default)
