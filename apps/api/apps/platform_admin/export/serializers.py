"""Response shapes of `:export`'s 202 and of a finished job's `:download`."""

from __future__ import annotations

from rest_framework import serializers


class ExportAcceptedSerializer(serializers.Serializer):
    job_id = serializers.UUIDField(help_text="Poll .../tenants/{tenant_pk}/jobs/{job_id}.")
    status = serializers.CharField(help_text="queued, or the status of the export in flight.")


class ExportDownloadSerializer(serializers.Serializer):
    download_url = serializers.CharField(help_text="A signed link to the archive.")
    expires_in = serializers.IntegerField(help_text="Seconds the link stays valid.")
