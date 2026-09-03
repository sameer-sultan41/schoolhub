from __future__ import annotations

from rest_framework import serializers

from core.jobs.models import BackgroundJob


class BackgroundJobSerializer(serializers.ModelSerializer):
    class Meta:
        model = BackgroundJob
        fields = (
            "id",
            "job_type",
            "status",
            "progress",
            "result",
            "error",
            "started_at",
            "finished_at",
            "created_at",
            "updated_at",
        )
        read_only_fields = fields
