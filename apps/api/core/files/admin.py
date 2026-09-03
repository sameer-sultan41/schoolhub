from django.contrib import admin

from core.files.models import File


@admin.register(File)
class FileAdmin(admin.ModelAdmin):
    list_select_related = True
    readonly_fields = ("id", "created_at", "updated_at", "created_by", "updated_by")
    list_display = ("original_name", "purpose", "status", "size_bytes", "tenant")
    list_filter = ("status", "purpose")
    search_fields = ("original_name", "storage_key")

    def get_queryset(self, request):
        return self.model.all_tenants.all()
