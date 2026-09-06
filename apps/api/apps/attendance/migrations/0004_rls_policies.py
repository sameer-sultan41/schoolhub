"""Enable Row-Level Security on the five leave tables.

All five are new in `0003_leave_system` and no other app's migrations touch them,
so none of the "already covered elsewhere" exclusions other modules carry apply.
`tests/test_rls_coverage.py` fails the build for any tenant-owned table without a
policy — and `leave_requests` carries a child's medical reason and, once hr-leave
lands, a staff member's, which is as sensitive as anything on the platform.
"""

from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("attendance", "0003_leave_system")]
    operations = [
        *rls_operations(
            "leave_types",
            "leave_policies",
            "leave_balances",
            "leave_requests",
            "leave_approvals",
        ),
    ]
