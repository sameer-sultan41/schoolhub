"""Account invitations (ADR-0033), tenant-owned, with their RLS policy in the same migration."""

import django.db.models.deletion
import uuid
from django.conf import settings
from django.db import migrations, models

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):

    dependencies = [
        ('rbac', '0001_initial'),
        ('tenancy', '0007_tenantsettings_communication'),
    ]

    operations = [
        migrations.CreateModel(
            name='Invitation',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('kind', models.CharField(choices=[('staff', 'Staff'), ('guardian', 'Guardian'), ('student', 'Student')], max_length=20)),
                ('token_hash', models.CharField(blank=True, default='', max_length=64)),
                ('expires_at', models.DateTimeField()),
                ('sent_at', models.DateTimeField(blank=True, null=True)),
                ('accepted_at', models.DateTimeField(blank=True, null=True)),
                ('revoked_at', models.DateTimeField(blank=True, null=True)),
                ('send_failed_at', models.DateTimeField(blank=True, null=True)),
                ('tenant', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='+', to='tenancy.tenant')),
                ('user', models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name='invitations', to=settings.AUTH_USER_MODEL)),
            ],
            options={
                'db_table': 'invitations',
                'indexes': [models.Index(fields=['tenant', 'user'], name='invitations_tenant__496483_idx')],
                'constraints': [models.UniqueConstraint(condition=models.Q(('token_hash', ''), _negated=True), fields=('token_hash',), name='invitations_unique_token_hash')],
            },
        ),
        *rls_operations("invitations"),
    ]
