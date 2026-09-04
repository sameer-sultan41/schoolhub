"""Django admin registration — a platform-operator tool, not a tenant surface.

See school_organization/admin.py's TenantOwnedAdmin docstring for why
``all_tenants`` here is not a tenancy bypass.
"""

from django.contrib import admin

from apps.staff_management.models import Designation, Staff, StaffDocument, StaffQualification


class TenantOwnedAdmin(admin.ModelAdmin):
    list_select_related = True
    readonly_fields = ("id", "created_at", "updated_at", "created_by", "updated_by")

    def get_queryset(self, request):
        return self.model.all_tenants.all()


@admin.register(Staff)
class StaffAdmin(TenantOwnedAdmin):
    list_display = (
        "employee_number",
        "last_name",
        "first_name",
        "staff_type",
        "employment_status",
        "campus",
        "tenant",
    )
    list_filter = ("staff_type", "employment_status")
    search_fields = ("employee_number", "first_name", "last_name", "email")


@admin.register(Designation)
class DesignationAdmin(TenantOwnedAdmin):
    list_display = ("name", "code", "level", "is_active", "tenant")
    list_filter = ("is_active",)
    search_fields = ("name", "code")


@admin.register(StaffQualification)
class StaffQualificationAdmin(TenantOwnedAdmin):
    list_display = ("staff", "title", "qualification_type", "verification_status", "tenant")
    list_filter = ("qualification_type", "verification_status")


@admin.register(StaffDocument)
class StaffDocumentAdmin(TenantOwnedAdmin):
    list_display = ("staff", "title", "document_type", "verification_status", "tenant")
    list_filter = ("document_type", "verification_status")
