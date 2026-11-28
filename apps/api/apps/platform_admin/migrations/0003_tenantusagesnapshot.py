import decimal
import uuid

import django.db.models.deletion
import django.utils.timezone
from django.db import migrations, models

from core.tenancy.grants import append_only_operations


class Migration(migrations.Migration):

    dependencies = [
        ('platform_admin', '0002_billingeventreceipt'),
        ('tenancy', '0010_tenant_platform_columns'),
    ]

    operations = [
        migrations.CreateModel(
            name='TenantUsageSnapshot',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('taken_at', models.DateTimeField(default=django.utils.timezone.now)),
                ('status', models.CharField(choices=[('provisioning', 'Provisioning'), ('trial', 'Trial'), ('active', 'Active'), ('past_due', 'Past due'), ('suspended', 'Suspended'), ('deprovisioned', 'Deprovisioned')], max_length=20)),
                ('plan_code', models.CharField(blank=True, default='', help_text="The live plan's code; blank for none.", max_length=50)),
                ('mrr_amount', models.DecimalField(decimal_places=2, default=decimal.Decimal('0'), help_text="The plan's price per month while paying (active or past due); 0 otherwise.", max_digits=12)),
                ('currency', models.CharField(blank=True, default='', max_length=3)),
                ('students', models.PositiveIntegerField()),
                ('staff', models.PositiveIntegerField()),
                ('storage_bytes', models.PositiveBigIntegerField()),
                ('impersonations_30d', models.PositiveIntegerField(blank=True, help_text='Impersonation grants in the last 30 days (PR E).', null=True)),
                ('modules_enabled', models.JSONField(blank=True, default=list, help_text='The `module.*` keys on for the school.')),
                ('tenant', models.ForeignKey(db_index=False, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='tenancy.tenant')),
            ],
            options={
                'db_table': 'tenant_usage_snapshots',
                'indexes': [models.Index(fields=['tenant', '-taken_at'], name='tenant_usage_snapshots_latest')],
            },
        ),
        # Platform scope, so no RLS; append-only, so no UPDATE or DELETE for the app role.
        *append_only_operations('tenant_usage_snapshots'),
    ]
