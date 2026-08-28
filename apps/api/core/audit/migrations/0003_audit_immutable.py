"""Make the audit trail immutable at the database level.

The model refuses updates and deletes in Python, but an audit trail the application
can rewrite is not evidence. Revoking the grants means even a compromised code path
cannot alter history.
"""

from django.db import migrations

REVOKE_MUTATIONS = """
REVOKE UPDATE, DELETE ON TABLE audit_logs FROM PUBLIC;
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolhub_app') THEN
        REVOKE UPDATE, DELETE ON TABLE audit_logs FROM schoolhub_app;
    END IF;
END
$$;
"""

RESTORE_MUTATIONS = """
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'schoolhub_app') THEN
        GRANT UPDATE, DELETE ON TABLE audit_logs TO schoolhub_app;
    END IF;
END
$$;
"""


class Migration(migrations.Migration):
    dependencies = [
        ("audit", "0002_initial"),
    ]

    operations = [
        migrations.RunSQL(sql=REVOKE_MUTATIONS, reverse_sql=RESTORE_MUTATIONS),
    ]
