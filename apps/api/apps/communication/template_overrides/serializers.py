"""`NotificationTemplateOverrideSerializer`/`NotificationTemplatePreviewSerializer`."""

from __future__ import annotations

from rest_framework import serializers

from apps.communication.models import NotificationTemplateOverride
from apps.communication.template_overrides.services.validate import assert_override_is_valid
from core.notifications.templates import used_placeholders


class NotificationTemplateOverrideSerializer(serializers.ModelSerializer):
    class Meta:
        model = NotificationTemplateOverride
        fields = [
            "id",
            "code",
            "name",
            "channel",
            "locale",
            "subject",
            "body",
            "variables",
            "is_system",
            "is_active",
            "created_at",
            "updated_at",
        ]
        read_only_fields = ["id", "variables", "is_system", "created_at", "updated_at"]

    def validate(self, attrs: dict) -> dict:
        # code/channel are locked on an existing row — `is_system` or not:
        # once a (code, channel) pair is chosen the row exists to override that
        # exact render target, and changing either is really "delete this
        # override and create a different one", which the API already supports.
        if self.instance is not None:
            for locked_field in ("code", "channel"):
                if locked_field in attrs and attrs[locked_field] != getattr(
                    self.instance, locked_field
                ):
                    raise serializers.ValidationError(
                        {locked_field: "Cannot be changed after creation."}
                    )

        # code/channel/body are required model fields — always a str by the
        # time either a create (attrs has them) or an update (self.instance
        # does) reaches here. The str() calls are for mypy, not runtime.
        code = str(attrs.get("code", getattr(self.instance, "code", "")))
        channel = str(attrs.get("channel", getattr(self.instance, "channel", "")))
        subject = attrs.get("subject", getattr(self.instance, "subject", None))
        body = str(attrs.get("body", getattr(self.instance, "body", "")))
        assert_override_is_valid(code=code, channel=channel, subject=subject, body=body)

        # `variables` is never author-editable (read-only above); it is derived
        # here from what the platform template itself declares, so a resolved
        # override always reports the same set the platform default would.
        used = used_placeholders(subject or "", body or "")
        attrs["variables"] = sorted(used)
        return attrs


class NotificationTemplatePreviewSerializer(serializers.Serializer):
    """Response shape for `:preview` — rendered with sample data, never persisted."""

    subject = serializers.CharField(allow_null=True)
    body = serializers.CharField()
