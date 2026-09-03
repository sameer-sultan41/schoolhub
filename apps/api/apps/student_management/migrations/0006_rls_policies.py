from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [
        ("student_management", "0005_studentenrollment_studenttransfer"),
    ]

    operations = [
        *rls_operations("student_enrollments", "student_transfers"),
    ]
