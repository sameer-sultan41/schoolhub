from django.contrib import admin

from core.idempotency.models import IdempotencyRecord


@admin.register(IdempotencyRecord)
class IdempotencyRecordAdmin(admin.ModelAdmin):
    list_select_related = True
    readonly_fields = ("id", "created_at", "updated_at", "created_by", "updated_by")
    list_display = ("endpoint", "key", "response_status", "tenant", "created_at")
    list_filter = ("endpoint", "response_status")
    search_fields = ("key",)

    def get_queryset(self, request):
        return self.model.all_tenants.all()
