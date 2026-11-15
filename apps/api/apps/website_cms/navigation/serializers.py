"""Serializers for `/navigation-menus`."""

from __future__ import annotations

from rest_framework import serializers

from apps.website_cms.constants import NavTargetType
from apps.website_cms.models import MenuLocation, NavigationMenu


class NavChildSerializer(serializers.Serializer):
    # The 1-60 bound is checked once, in `navigation.services`, so it answers a field-keyed 422.
    label = serializers.CharField(allow_blank=True, trim_whitespace=False)
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
