"""Enable Row-Level Security on the two tables 0006 adds, and make `messages` append-only.

Adding a table to this app means adding it here too; ``tests/test_rls_coverage.py``
compares the models against the policies actually present in the database and
fails the build on any omission.

`messages` is append-only: ``append_only_operations`` revokes UPDATE and DELETE
from the application role, then grants UPDATE on `read_by` alone — the receipt
map is the one thing stamped on a row after it is sent. The column list must stay
identical to ``Message.MUTABLE_FIELDS``; ``tests/test_append_only_coverage.py``
fails the build if they diverge. `message_threads` is an ordinary mutable table
(status, assignee, ``last_message_at``), so it gets RLS only.
"""

from django.db import migrations

from core.tenancy.grants import append_only_operations
from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [("communication", "0006_message_threads")]
    operations = [
        *rls_operations("message_threads", "messages"),
        *append_only_operations("messages", mutable_columns={"messages": ["read_by"]}),
    ]
