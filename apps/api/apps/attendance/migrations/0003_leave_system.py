"""The shared leave system, and the foreign key `student_attendance` was waiting for.

Five tables — `leave_types`, `leave_policies`, `leave_balances`, `leave_requests`,
`leave_approvals` — which `attendance.md` §15 and `hr-leave.md` §15 both claim.
Only one app can ship the migration and it is this one, because attendance is the
module that ships first; hr-leave (Tier 6) adds no tables and layers staff policy,
accrual and the editable approval engine on top.

**`student_attendance.leave_request_id` is dropped and re-added as a real foreign
key rather than altered in place.** That is a destructive operation on any other
column, and it is safe on exactly this one: it shipped in `0001_initial` with
nothing able to write it (the table it referenced did not exist), so every row
holds NULL by construction. Django cannot express "this UUIDField was always a
foreign key" as an AlterField across the model-name change, and faking one with
RunSQL would be less readable for no gain.
"""


import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('attendance', '0002_rls_policies'),
        ('files', '0002_rls_policies'),
        ('staff_management', '0002_rls_policies'),
        ('student_management', '0006_rls_policies'),
        ('tenancy', '0005_tenantsettings_hr'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='studentattendance',
            name='leave_request_id',
        ),
        migrations.CreateModel(
            name='LeaveRequest',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('requester_type', models.CharField(choices=[('staff', 'Staff'), ('student', 'Student')], max_length=10)),
                ('submitted_by', models.UUIDField(help_text='users(id); a guardian may submit for a student.')),
                ('start_date', models.DateField()),
                ('end_date', models.DateField()),
                ('day_part', models.CharField(choices=[('full', 'Full day'), ('first_half', 'First half'), ('second_half', 'Second half')], default='full', max_length=20)),
                ('days_count', models.DecimalField(decimal_places=1, help_text='Computed net of holidays (§11).', max_digits=5)),
                ('reason', models.CharField(max_length=1000)),
                ('status', models.CharField(choices=[('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected'), ('cancelled', 'Cancelled')], default='pending', max_length=20)),
                ('current_approval_level', models.PositiveSmallIntegerField(default=1, help_text="Step pointer into the tenant's approval chain (§7.2).")),
                ('decided_at', models.DateTimeField(blank=True, null=True)),
                ('attachment_file', models.ForeignKey(blank=True, db_column='attachment_file_id', null=True, on_delete=django.db.models.deletion.PROTECT, related_name='leave_requests', to='files.file')),
                ('staff', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='leave_requests', to='staff_management.staff')),
                ('student', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='leave_requests', to='student_management.student')),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='tenancy.tenant')),
            ],
            options={
                'db_table': 'leave_requests',
                'ordering': ['-start_date'],
            },
        ),
        migrations.AddField(
            model_name='studentattendance',
            name='leave_request',
            field=models.ForeignKey(blank=True, db_column='leave_request_id', help_text='Set when status is on_leave; written by the leave module, never marked.', null=True, on_delete=django.db.models.deletion.PROTECT, related_name='student_attendance', to='attendance.leaverequest'),
        ),
        migrations.CreateModel(
            name='LeaveType',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('name', models.CharField(help_text='e.g. "Sick Leave".', max_length=100)),
                ('code', models.CharField(max_length=20)),
                ('applies_to', models.CharField(choices=[('staff', 'Staff'), ('student', 'Student'), ('both', 'Both')], default='both', max_length=10)),
                ('is_paid', models.BooleanField(default=True, help_text='Staff payroll relevance only; meaningless for a student.')),
                ('requires_attachment', models.BooleanField(default=False, help_text='e.g. a medical note (§6).')),
                ('max_consecutive_days', models.PositiveSmallIntegerField(blank=True, help_text='Null = unlimited.', null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='tenancy.tenant')),
            ],
            options={
                'db_table': 'leave_types',
                'ordering': ['name'],
            },
        ),
        migrations.AddField(
            model_name='leaverequest',
            name='leave_type',
            field=models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='requests', to='attendance.leavetype'),
        ),
        migrations.CreateModel(
            name='LeavePolicy',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('name', models.CharField(max_length=100)),
                ('annual_quota_days', models.DecimalField(decimal_places=1, help_text='Entitlement per cycle; half-days supported.', max_digits=5)),
                ('accrual_frequency', models.CharField(choices=[('annual', 'Annual'), ('monthly', 'Monthly')], default='annual', max_length=20)),
                ('carry_forward_max_days', models.DecimalField(decimal_places=1, default=0, max_digits=5)),
                ('min_notice_days', models.PositiveSmallIntegerField(default=0)),
                ('applicability', models.JSONField(blank=True, help_text='Optional filter: departments/designations/employment types.', null=True)),
                ('effective_from', models.DateField()),
                ('effective_to', models.DateField(blank=True, help_text='Null = open-ended.', null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='tenancy.tenant')),
                ('leave_type', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='policies', to='attendance.leavetype')),
            ],
            options={
                'db_table': 'leave_policies',
                'ordering': ['-effective_from'],
            },
        ),
        migrations.CreateModel(
            name='LeaveBalance',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('period_start', models.DateField(help_text='Balance cycle start (session or calendar year).')),
                ('period_end', models.DateField()),
                ('entitled_days', models.DecimalField(decimal_places=1, max_digits=5)),
                ('carried_forward_days', models.DecimalField(decimal_places=1, default=0, max_digits=5)),
                ('used_days', models.DecimalField(decimal_places=1, default=0, max_digits=5)),
                ('pending_days', models.DecimalField(decimal_places=1, default=0, help_text='Soft hold for pending requests.', max_digits=5)),
                ('staff', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='leave_balances', to='staff_management.staff')),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='tenancy.tenant')),
                ('leave_policy', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='balances', to='attendance.leavepolicy')),
            ],
            options={
                'db_table': 'leave_balances',
                'ordering': ['-period_start'],
                'constraints': [models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True)), fields=('tenant', 'staff', 'leave_policy', 'period_start'), name='leave_balances_unique_cycle'), models.CheckConstraint(condition=models.Q(('period_end__gte', models.F('period_start'))), name='leave_balances_period_range')],
            },
        ),
        migrations.CreateModel(
            name='LeaveApproval',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('level', models.PositiveSmallIntegerField(help_text='1-based step order.')),
                ('required_permission', models.CharField(help_text='e.g. attendance.leave-request.approve.', max_length=100)),
                ('approver_id', models.UUIDField(blank=True, help_text='users(id); set on decision, differs from submitted_by.', null=True)),
                ('decision', models.CharField(choices=[('pending', 'Pending'), ('approved', 'Approved'), ('rejected', 'Rejected'), ('skipped', 'Skipped')], default='pending', max_length=20)),
                ('decided_at', models.DateTimeField(blank=True, null=True)),
                ('note', models.CharField(blank=True, max_length=500, null=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='tenancy.tenant')),
                ('leave_request', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='approvals', to='attendance.leaverequest')),
            ],
            options={
                'db_table': 'leave_approvals',
                'ordering': ['level'],
                'indexes': [models.Index(fields=['tenant', 'approver_id', 'decision'], name='leave_step_approver_idx')],
                'constraints': [models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True)), fields=('tenant', 'leave_request', 'level'), name='leave_approvals_unique_level')],
            },
        ),
        migrations.AddIndex(
            model_name='leavetype',
            index=models.Index(fields=['tenant', 'applies_to', 'is_active'], name='leave_types_use_idx'),
        ),
        migrations.AddConstraint(
            model_name='leavetype',
            constraint=models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True)), fields=('tenant', 'code'), name='leave_types_unique_code'),
        ),
        migrations.AddIndex(
            model_name='leaverequest',
            index=models.Index(fields=['tenant', 'staff', 'start_date'], name='leave_req_staff_idx'),
        ),
        migrations.AddIndex(
            model_name='leaverequest',
            index=models.Index(fields=['tenant', 'student', 'start_date'], name='leave_req_student_idx'),
        ),
        migrations.AddIndex(
            model_name='leaverequest',
            index=models.Index(fields=['tenant', 'status'], name='leave_req_status_idx'),
        ),
        migrations.AddConstraint(
            model_name='leaverequest',
            constraint=models.CheckConstraint(condition=models.Q(models.Q(('staff__isnull', False), ('student__isnull', True)), models.Q(('staff__isnull', True), ('student__isnull', False)), _connector='OR'), name='leave_requests_exactly_one_subject'),
        ),
        migrations.AddConstraint(
            model_name='leaverequest',
            constraint=models.CheckConstraint(condition=models.Q(('end_date__gte', models.F('start_date'))), name='leave_requests_end_on_or_after_start'),
        ),
        migrations.AddIndex(
            model_name='leavepolicy',
            index=models.Index(fields=['tenant', 'leave_type', 'is_active'], name='leave_policies_active_idx'),
        ),
        migrations.AddConstraint(
            model_name='leavepolicy',
            constraint=models.CheckConstraint(condition=models.Q(('effective_to__isnull', True), ('effective_to__gte', models.F('effective_from')), _connector='OR'), name='leave_policies_effective_range'),
        ),
    ]
