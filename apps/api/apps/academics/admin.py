from django.contrib import admin

from apps.academics.models import StudentPromotion, TeacherSubjectAllocation


class TenantOwnedAdmin(admin.ModelAdmin):
    list_select_related = True
    readonly_fields = ("id", "created_at", "updated_at", "created_by", "updated_by")

    def get_queryset(self, request):
        return self.model.all_tenants.all()


@admin.register(TeacherSubjectAllocation)
class TeacherSubjectAllocationAdmin(TenantOwnedAdmin):
    list_display = ("id", "academic_session", "section", "subject", "staff", "is_primary")
    list_filter = ("is_primary",)


@admin.register(StudentPromotion)
class StudentPromotionAdmin(TenantOwnedAdmin):
    list_display = ("id", "batch_id", "student", "decision", "status")
    list_filter = ("status", "decision")
