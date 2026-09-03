"""Django admin registration — a platform-operator tool, not a tenant surface.

See school_organization/admin.py's TenantOwnedAdmin docstring for why
``all_tenants`` here is not a tenancy bypass.
"""

from django.contrib import admin

from apps.student_management.models import (
    EmergencyContact,
    Guardian,
    Student,
    StudentDocument,
    StudentGuardian,
)


class TenantOwnedAdmin(admin.ModelAdmin):
    list_select_related = True
    readonly_fields = ("id", "created_at", "updated_at", "created_by", "updated_by")

    def get_queryset(self, request):
        return self.model.all_tenants.all()


@admin.register(Student)
class StudentAdmin(TenantOwnedAdmin):
    list_display = ("admission_number", "last_name", "first_name", "status", "campus", "tenant")
    list_filter = ("status",)
    search_fields = ("admission_number", "first_name", "last_name")


@admin.register(Guardian)
class GuardianAdmin(TenantOwnedAdmin):
    list_display = ("last_name", "first_name", "phone", "tenant")
    search_fields = ("first_name", "last_name", "phone", "email")


@admin.register(StudentGuardian)
class StudentGuardianAdmin(TenantOwnedAdmin):
    list_display = ("student", "guardian", "relationship", "is_primary", "tenant")
    list_filter = ("relationship", "is_primary")


@admin.register(EmergencyContact)
class EmergencyContactAdmin(TenantOwnedAdmin):
    list_display = ("student", "name", "relationship", "priority", "tenant")


@admin.register(StudentDocument)
class StudentDocumentAdmin(TenantOwnedAdmin):
    list_display = ("student", "title", "document_type", "verification_status", "tenant")
    list_filter = ("document_type", "verification_status")
