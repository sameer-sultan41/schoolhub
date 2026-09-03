from django.apps import AppConfig


class StudentManagementConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.student_management"
    label = "student_management"
    verbose_name = "Student Management"
