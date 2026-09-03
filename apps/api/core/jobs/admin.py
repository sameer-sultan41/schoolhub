from django.contrib import admin

from core.jobs.models import BackgroundJob


@admin.register(BackgroundJob)
class BackgroundJobAdmin(admin.ModelAdmin):
    list_select_related = True
    readonly_fields = ("id", "created_at", "updated_at", "created_by", "updated_by")
    list_display = ("job_type", "status", "progress", "tenant", "created_at")
    list_filter = ("job_type", "status")

    def get_queryset(self, request):
        return self.model.all_tenants.all()
