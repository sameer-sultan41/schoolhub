import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('platform_admin', '0001_initial'),
        ('tenancy', '0010_tenant_platform_columns'),
    ]

    operations = [
        migrations.CreateModel(
            name='BillingEventReceipt',
            fields=[
                ('id', models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ('created_at', models.DateTimeField(auto_now_add=True, db_index=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('created_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('updated_by', models.UUIDField(blank=True, editable=False, null=True)),
                ('deleted_at', models.DateTimeField(blank=True, db_index=True, null=True)),
                ('provider', models.CharField(max_length=30)),
                ('event_id', models.CharField(max_length=200)),
                ('kind', models.CharField(max_length=40)),
                ('provider_ref', models.CharField(max_length=120)),
                ('outcome', models.CharField(choices=[('applied', 'Applied'), ('ignored', 'Ignored'), ('unknown_ref', 'Unknown reference'), ('no_subscription', 'No live subscription')], max_length=20)),
                ('tenant', models.ForeignKey(blank=True, help_text='The school the reference named, if any.', null=True, on_delete=django.db.models.deletion.PROTECT, related_name='+', to='tenancy.tenant')),
            ],
            options={
                'db_table': 'billing_event_receipts',
                'constraints': [models.UniqueConstraint(fields=('provider', 'event_id'), name='billing_event_receipts_unique_event')],
            },
        ),
    ]
