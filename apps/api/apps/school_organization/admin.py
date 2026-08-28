"""Django admin registrations — a platform-operator tool, not a tenant surface.

The tenant-scoped default manager would show nothing here (admin runs with no
request tenant), so these use ``all_tenants``. That is not a bypass: PostgreSQL
RLS still filters every row, so an admin session only sees data when the database
connection uses a platform role.
"""

from django.contrib import admin

from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    ClassSubject,
    Department,
    House,
    Section,
    Subject,
    Term,
)


class TenantOwnedAdmin(admin.ModelAdmin):
    list_select_related = True
    readonly_fields = ("id", "created_at", "updated_at", "created_by", "updated_by")

    def get_queryset(self, request):
        return self.model.all_tenants.all()


@admin.register(Campus)
class CampusAdmin(TenantOwnedAdmin):
    list_display = ("name", "code", "is_primary", "is_active", "tenant")
    list_filter = ("is_active", "is_primary")
    search_fields = ("name", "code")


@admin.register(Department)
class DepartmentAdmin(TenantOwnedAdmin):
    list_display = ("name", "code", "department_type", "is_active", "tenant")
    list_filter = ("department_type", "is_active")
    search_fields = ("name", "code")


@admin.register(AcademicSession)
class AcademicSessionAdmin(TenantOwnedAdmin):
    list_display = ("name", "start_date", "end_date", "status", "is_current", "tenant")
    list_filter = ("status", "is_current")
    search_fields = ("name",)


@admin.register(Term)
class TermAdmin(TenantOwnedAdmin):
    list_display = ("name", "academic_session", "sequence", "start_date", "end_date")
    search_fields = ("name",)


@admin.register(Class)
class ClassAdmin(TenantOwnedAdmin):
    list_display = ("name", "code", "level", "is_active", "tenant")
    list_filter = ("is_active",)
    search_fields = ("name", "code")


@admin.register(Section)
class SectionAdmin(TenantOwnedAdmin):
    list_display = ("name", "school_class", "campus", "capacity", "is_active")
    list_filter = ("is_active",)
    search_fields = ("name",)


@admin.register(Subject)
class SubjectAdmin(TenantOwnedAdmin):
    list_display = ("name", "code", "subject_type", "department", "is_active")
    list_filter = ("subject_type", "is_active")
    search_fields = ("name", "code")


@admin.register(ClassSubject)
class ClassSubjectAdmin(TenantOwnedAdmin):
    list_display = ("academic_session", "school_class", "subject", "campus", "weekly_periods")
    list_filter = ("is_elective",)


@admin.register(House)
class HouseAdmin(TenantOwnedAdmin):
    list_display = ("name", "code", "is_active", "tenant")
    list_filter = ("is_active",)
    search_fields = ("name", "code")
