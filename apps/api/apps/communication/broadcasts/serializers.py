"""Serializers for `/broadcasts:preview`, `/broadcasts:emergency` and `/broadcasts:scope`."""

from __future__ import annotations

import uuid

from django.db.models import QuerySet
from rest_framework import serializers
from rest_framework.exceptions import NotFound

from apps.communication.models import AudienceType
from apps.school_organization.models import Campus, Class, House, Section
from core.rbac.models import User

# A broadcast reaches SMS; the cap keeps a message a few segments long, not a letter.
BROADCAST_MESSAGE_MAX_LENGTH = 1000

# The `audience_filter` keys that name tenant rows, each checked against its table.
TARGETING_ID_KEYS = ("class_ids", "section_ids", "house_ids", "campus_ids", "user_ids")


class BroadcastAudienceFilterSerializer(serializers.Serializer):
    """The `audience_filter` keys `audience.resolve_audience` reads."""

    class_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    section_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    house_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    campus_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    user_ids = serializers.ListField(child=serializers.UUIDField(), required=False)
    role_slugs = serializers.ListField(child=serializers.CharField(), required=False)


class BroadcastRequestSerializer(serializers.Serializer):
    """Who the broadcast goes to and what it says.

    Every targeting id must be a live row of the caller's tenant, else **404**
    (§11): plain UUIDs, not related fields, because a related field answers an
    unknown id with a 400 naming it. Needs `tenant_id` in the context.

    `validated_data["audience_filter"]` comes back JSON-ready (ids as strings),
    since it is stored on the job and in the audit row as is.
    """

    audience_type = serializers.ChoiceField(choices=AudienceType.choices)
    audience_filter = BroadcastAudienceFilterSerializer(required=False)
    campus_id = serializers.UUIDField(required=False, allow_null=True, default=None)
    message = serializers.CharField(max_length=BROADCAST_MESSAGE_MAX_LENGTH)

    def validate(self, attrs: dict) -> dict:
        tenant_id: uuid.UUID = self.context["tenant_id"]
        audience_filter: dict = attrs.get("audience_filter") or {}

        targets: dict[str, QuerySet] = {
            "class_ids": Class.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True),
            "section_ids": Section.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True),
            "house_ids": House.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True),
            "campus_ids": Campus.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True),
            "user_ids": User.objects.filter(tenant_id=tenant_id, deleted_at__isnull=True),
        }
        for key in TARGETING_ID_KEYS:
            _assert_all_found(targets[key], audience_filter.get(key) or [])
        if attrs["campus_id"] is not None:
            _assert_all_found(targets["campus_ids"], [attrs["campus_id"]])

        attrs["audience_filter"] = {
            key: [str(value) for value in values] for key, values in audience_filter.items()
        }
        return attrs


class BroadcastSendSerializer(BroadcastRequestSerializer):
    """The preview's answer, repeated back: a mismatch on either is a 409."""

    confirm_recipient_count = serializers.IntegerField(min_value=1)
    audience_digest = serializers.CharField()


class BroadcastPreviewSerializer(serializers.Serializer):
    """What a send would do right now."""

    recipient_count = serializers.IntegerField()
    audience_digest = serializers.CharField(
        help_text="sha256 hex of the sorted recipient ids joined by ','; send repeats it back."
    )
    channels = serializers.ListField(child=serializers.CharField())
    unavailable_channels = serializers.ListField(
        child=serializers.CharField(),
        help_text="Channels the trigger declares that have no adapter yet; recorded as skipped.",
    )


class BroadcastPreviewResponseSerializer(serializers.Serializer):
    data = BroadcastPreviewSerializer()


class BroadcastQueuedSerializer(serializers.Serializer):
    job_id = serializers.UUIDField()
    status = serializers.CharField()


class BroadcastQueuedResponseSerializer(serializers.Serializer):
    """`ActionResponse.accepted`'s body; poll `GET /jobs/{job_id}`."""

    data = BroadcastQueuedSerializer()


class BroadcastScopeSerializer(serializers.Serializer):
    """Where the caller may broadcast, read from the same rule the send enforces."""

    campus_ids = serializers.ListField(
        child=serializers.UUIDField(),
        allow_null=True,
        help_text=(
            "null: unrestricted, so `campus_id` is optional and may be any campus. A list: "
            "the only campuses the caller may target, one of which a send must name as "
            "`campus_id`; an empty list means the caller can reach no campus."
        ),
    )


class BroadcastScopeResponseSerializer(serializers.Serializer):
    data = BroadcastScopeSerializer()


def _assert_all_found(queryset: QuerySet, ids: list[uuid.UUID]) -> None:
    """404 unless every id is a row of ``queryset`` — never says which one is missing."""
    wanted = set(ids)
    if not wanted:
        return
    found = set(queryset.filter(pk__in=wanted).values_list("pk", flat=True))
    if found != wanted:
        raise NotFound()
