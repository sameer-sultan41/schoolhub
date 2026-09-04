import django.db.models.deletion
import uuid
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ('school_organization', '0002_rls_policies'),
        ('files', '0002_rls_policies'),
        ('tenancy', '0005_tenantsettings_hr'),
    ]

    operations = [
        migrations.CreateModel(
            name='Designation',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('name', models.CharField(max_length=100)),
                ('code', models.CharField(blank=True, max_length=20, null=True)),
                ('description', models.CharField(blank=True, max_length=300, null=True)),
                ('level', models.SmallIntegerField(blank=True, help_text='Optional seniority ordering.', null=True)),
                ('is_active', models.BooleanField(default=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='tenancy.tenant')),
            ],
            options={
                'db_table': 'designations',
                'ordering': ['name'],
                'constraints': [
                    models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True)), fields=('tenant', 'name'), name='designations_unique_name_per_tenant'),
                    models.UniqueConstraint(condition=models.Q(('code__isnull', False), ('deleted_at__isnull', True)), fields=('tenant', 'code'), name='designations_unique_code_per_tenant'),
                ],
            },
        ),
        migrations.CreateModel(
            name='Staff',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('employee_number', models.CharField(help_text="Generated per the tenant's employee-number pattern. Immutable after creation (§11) — see services.assert_employee_number_immutable.", max_length=32)),
                ('user_id', models.UUIDField(blank=True, help_text='users(id) — portal account, tenant-checked at write time.', null=True)),
                ('first_name', models.CharField(max_length=100)),
                ('last_name', models.CharField(max_length=100)),
                ('gender', models.CharField(choices=[('male', 'Male'), ('female', 'Female'), ('other', 'Other'), ('unspecified', 'Unspecified')], default='unspecified', max_length=20)),
                ('date_of_birth', models.DateField(blank=True, null=True)),
                ('staff_type', models.CharField(choices=[('teaching', 'Teaching'), ('non_teaching', 'Non-teaching')], max_length=20)),
                ('employment_type', models.CharField(choices=[('full_time', 'Full time'), ('part_time', 'Part time'), ('contract', 'Contract'), ('visiting', 'Visiting')], default='full_time', max_length=20)),
                ('employment_status', models.CharField(choices=[('active', 'Active'), ('on_leave', 'On leave'), ('suspended', 'Suspended'), ('resigned', 'Resigned'), ('retired', 'Retired'), ('terminated', 'Terminated')], default='active', max_length=20)),
                ('joining_date', models.DateField()),
                ('exit_date', models.DateField(blank=True, null=True)),
                ('exit_reason', models.CharField(blank=True, max_length=300, null=True)),
                ('email', models.EmailField(blank=True, max_length=254, null=True)),
                ('phone', models.CharField(max_length=32)),
                ('national_id', models.CharField(blank=True, max_length=64, null=True)),
                ('public_bio', models.TextField(blank=True, help_text='Opt-in website-published bio (§10).', null=True)),
                ('address', models.JSONField(blank=True, null=True)),
                ('custom_fields', models.JSONField(blank=True, default=dict)),
                ('photo_file', models.ForeignKey(blank=True, db_column='photo_file_id', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='files.file')),
                ('campus', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='staff', to='school_organization.campus')),
                ('department', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='staff', to='school_organization.department')),
                ('designation', models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='staff', to='staff_management.designation')),
                ('reports_to', models.ForeignKey(blank=True, db_column='reports_to_staff_id', null=True, on_delete=django.db.models.deletion.PROTECT, related_name='direct_reports', to='staff_management.staff')),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='tenancy.tenant')),
            ],
            options={
                'db_table': 'staff',
                'ordering': ['last_name', 'first_name'],
                'indexes': [
                    models.Index(fields=['tenant', 'campus'], name='staff_tenant_campus_idx'),
                    models.Index(fields=['tenant', 'department'], name='staff_tenant_department_idx'),
                    models.Index(fields=['tenant', 'employment_status'], name='staff_tenant_status_idx'),
                    models.Index(fields=['tenant', 'staff_type'], name='staff_tenant_type_idx'),
                    models.Index(fields=['tenant', 'last_name', 'first_name'], name='staff_tenant_name_idx'),
                ],
                'constraints': [
                    models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True)), fields=('tenant', 'employee_number'), name='staff_unique_employee_number_per_tenant'),
                    models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True), ('user_id__isnull', False)), fields=('tenant', 'user_id'), name='staff_unique_user_per_tenant'),
                    models.UniqueConstraint(condition=models.Q(('deleted_at__isnull', True), ('national_id__isnull', False)), fields=('tenant', 'national_id'), name='staff_unique_national_id_per_tenant'),
                    models.CheckConstraint(condition=models.Q(('exit_date__isnull', True), ('exit_date__gte', models.F('joining_date')), _connector='OR'), name='staff_exit_on_or_after_joining'),
                ],
            },
        ),
        migrations.CreateModel(
            name='StaffQualification',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('qualification_type', models.CharField(choices=[('degree', 'Degree'), ('diploma', 'Diploma'), ('certification', 'Certification'), ('training', 'Training'), ('license', 'License')], max_length=30)),
                ('title', models.CharField(max_length=200)),
                ('institution', models.CharField(blank=True, max_length=200, null=True)),
                ('field_of_study', models.CharField(blank=True, max_length=120, null=True)),
                ('year_awarded', models.SmallIntegerField(blank=True, null=True)),
                ('grade', models.CharField(blank=True, max_length=50, null=True)),
                ('verification_status', models.CharField(choices=[('pending', 'Pending'), ('verified', 'Verified'), ('rejected', 'Rejected')], default='pending', max_length=20)),
                ('verified_by', models.UUIDField(blank=True, help_text='users(id).', null=True)),
                ('verified_at', models.DateTimeField(blank=True, null=True)),
                ('document_file', models.ForeignKey(blank=True, db_column='document_file_id', null=True, on_delete=django.db.models.deletion.SET_NULL, related_name='+', to='files.file')),
                ('staff', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='qualifications', to='staff_management.staff')),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='tenancy.tenant')),
            ],
            options={
                'db_table': 'staff_qualifications',
                'ordering': ['staff_id', '-year_awarded'],
                'indexes': [
                    models.Index(fields=['tenant', 'staff'], name='staff_qual_tenant_staff_idx'),
                    models.Index(fields=['tenant', 'qualification_type'], name='staff_qual_type_idx'),
                    models.Index(condition=models.Q(('field_of_study__isnull', False)), fields=['tenant', 'field_of_study'], name='staff_qual_field_idx'),
                ],
                'constraints': [
                    models.CheckConstraint(condition=models.Q(models.Q(('verification_status', 'pending'), ('verified_at__isnull', True), ('verified_by__isnull', True)), models.Q(models.Q(('verification_status', 'pending'), _negated=True), ('verified_at__isnull', False), ('verified_by__isnull', False)), _connector='OR'), name='staff_qualifications_verifier_required_when_decided'),
                ],
            },
        ),
        migrations.CreateModel(
            name='StaffDocument',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('document_type', models.CharField(help_text='Tenant-extensible; seeded values: contract, national_id, resume, police_clearance, medical_certificate, other.', max_length=50)),
                ('title', models.CharField(max_length=200)),
                ('notes', models.CharField(blank=True, max_length=500, null=True)),
                ('verification_status', models.CharField(choices=[('pending', 'Pending'), ('verified', 'Verified'), ('rejected', 'Rejected')], default='pending', max_length=20)),
                ('verified_by', models.UUIDField(blank=True, help_text='users(id).', null=True)),
                ('verified_at', models.DateTimeField(blank=True, null=True)),
                ('expires_at', models.DateField(blank=True, null=True)),
                ('file', models.ForeignKey(db_column='file_id', on_delete=django.db.models.deletion.PROTECT, related_name='+', to='files.file')),
                ('staff', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='documents', to='staff_management.staff')),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='tenancy.tenant')),
            ],
            options={
                'db_table': 'staff_documents',
                'ordering': ['staff_id', 'document_type'],
                'indexes': [
                    models.Index(fields=['tenant', 'staff', 'document_type'], name='staff_documents_type_idx'),
                    models.Index(fields=['tenant', 'verification_status'], name='staff_documents_status_idx'),
                    models.Index(condition=models.Q(('expires_at__isnull', False)), fields=['tenant', 'expires_at'], name='staff_documents_expiry_idx'),
                ],
                'constraints': [
                    models.CheckConstraint(condition=models.Q(models.Q(('verification_status', 'pending'), ('verified_at__isnull', True), ('verified_by__isnull', True)), models.Q(models.Q(('verification_status', 'pending'), _negated=True), ('verified_at__isnull', False), ('verified_by__isnull', False)), _connector='OR'), name='staff_documents_verifier_required_when_decided'),
                ],
            },
        ),
    ]
