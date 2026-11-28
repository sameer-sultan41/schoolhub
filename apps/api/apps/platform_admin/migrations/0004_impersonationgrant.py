import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('platform_admin', '0003_tenantusagesnapshot'),
        ('tenancy', '0010_tenant_platform_columns'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name='ImpersonationGrant',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('reason', models.TextField()),
                ('expires_at', models.DateTimeField()),
                ('released_at', models.DateTimeField(blank=True, null=True)),
                ('end_reason', models.CharField(blank=True, choices=[('released', 'Released'), ('revoked', 'Revoked'), ('superseded', 'Superseded'), ('expired', 'Expired')], default='', max_length=20)),
                ('handoff_code_hash', models.CharField(max_length=64, unique=True)),
                ('handoff_expires_at', models.DateTimeField()),
                ('handoff_used_at', models.DateTimeField(blank=True, null=True)),
                ('granted_to', models.ForeignKey(help_text='The platform operator who holds the grant.', on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('target_user', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to=settings.AUTH_USER_MODEL)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.PROTECT, related_name='+', to='tenancy.tenant')),
            ],
            options={
                'db_table': 'impersonation_grants',
                'indexes': [
                    models.Index(fields=['tenant', '-created_at'], name='impersonation_grants_tenant'),
                    models.Index(condition=models.Q(('released_at__isnull', True)), fields=['expires_at'], name='impersonation_grants_open'),
                ],
                'constraints': [
                    models.UniqueConstraint(condition=models.Q(('released_at__isnull', True)), fields=('granted_to', 'target_user'), name='impersonation_grants_one_open_per_pair'),
                ],
            },
        ),
    ]
