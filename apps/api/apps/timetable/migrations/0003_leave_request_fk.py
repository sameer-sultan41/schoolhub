"""`teacher_substitutions.leave_request_id` becomes a real foreign key.

The column shipped in `0001_initial` as a plain UUIDField with a comment saying
so: "not an FK: the attendance module that owns that table has not shipped yet".
It has now shipped, so the column becomes what it always described.

Dropped and re-added rather than altered, and safe for the same reason
attendance's own `0003_leave_system` gives: nothing could ever write this column
— the serializer declared it read-only and no service set it — so every row holds
NULL by construction.
"""


import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('attendance', '0003_leave_system'),
        ('timetable', '0002_rls_policies'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='teachersubstitution',
            name='leave_request_id',
        ),
        migrations.AddField(
            model_name='teachersubstitution',
            name='leave_request',
            field=models.ForeignKey(blank=True, db_column='leave_request_id', help_text='The approved staff leave this cover is for, when there is one.', null=True, on_delete=django.db.models.deletion.PROTECT, related_name='substitutions', to='attendance.leaverequest'),
        ),
    ]
