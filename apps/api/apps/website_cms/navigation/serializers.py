"""Serializers for `/navigation-menus`."""

from __future__ import annotations

from rest_framework import serializers

from apps.website_cms.constants import NAV_LABEL_MAX_LENGTH, NavTargetType
from apps.website_cms.models import MenuLocation, NavigationMenu


class NavChildSerializer(serializers.Serializer):
    label = serializers.CharField(max_length=NAV_LABEL_MAX_LENGTH)
    target_type = serializers.ChoiceField(choices=NavTargetType.choices)
    target = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    # Accepted only so a too-deep tree gets the `depth_exceeded` 422, not a silent drop.
    children = serializers.ListField(child=serializers.DictField(), required=False)


class NavItemSerializer(NavChildSerializer):
    children = NavChildSerializer(many=True, required=False)


class NavigationMenuSerializer(serializers.ModelSerializer):
    location = serializers.ChoiceField(choices=MenuLocation.choices, read_only=True)
    items = NavItemSerializer(many=True, read_only=True)

    class Meta:
        model = NavigationMenu
        fields = ["location", "items", "updated_at"]
        read_only_fields = fields


class NavigationMenuUpdateSerializer(serializers.Serializer):
    items = NavItemSerializer(many=True)
