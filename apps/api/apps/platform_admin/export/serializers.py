"""The console's view of a platform job: the job, and a signed link to its result file."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from core.files.models import File
from core.files.services import get_download_url, servable_file
from core.jobs.models import BackgroundJob
from core.jobs.serializers import BackgroundJobSerializer


class PlatformJobSerializer(BackgroundJobSerializer):
    download_url = serializers.SerializerMethodField(
        help_text="A short-lived signed link to the result file once the job succeeded; "
        "poll again for a fresh one."
    )

    class Meta:
        model = BackgroundJob
        fields: tuple[str, ...] = (*BackgroundJobSerializer.Meta.fields, "download_url")
        read_only_fields = fields

    @extend_schema_field(serializers.CharField(allow_null=True))
    def get_download_url(self, job) -> str | None:
        file_id = (job.result or {}).get("result_file_id")
        if not file_id:
            return None
        # Read with the job's school bound (the request binds it), so RLS scopes the lookup.
        file = servable_file(File.objects.filter(pk=file_id).first())
        return get_download_url(file) if file is not None else None
