from django.db import migrations

from core.tenancy.rls import rls_operations


class Migration(migrations.Migration):
    dependencies = [
        ("student_management", "0003_remove_student_photo_file_id_student_photo_file_and_more"),
    ]

    operations = [
        *rls_operations("guardians", "student_guardians", "emergency_contacts", "student_documents"),
    ]
