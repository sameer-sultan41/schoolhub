"""`/onboarding` request and response shapes (platform-admin §16)."""

from __future__ import annotations

from rest_framework import serializers

from apps.platform_admin.onboarding.services import OnboardingStepKey

ACTIONS = ("confirm", "skip", "unskip")


class OnboardingStepSerializer(serializers.Serializer):
    """One step. Response only.

    `count` is not read-only so that the schema marks it optional: it is the number of rows
    meeting the step's rule, and the `profile` and `go_live` steps, which count nothing, omit it.
    """

    key = serializers.ChoiceField(choices=OnboardingStepKey.choices, read_only=True)
    done = serializers.BooleanField(read_only=True)
    skipped = serializers.BooleanField(read_only=True)
    skippable = serializers.BooleanField(read_only=True)
    count = serializers.IntegerField(required=False, min_value=0)


class OnboardingSerializer(serializers.Serializer):
    """The checklist: the school's steps (omitting any whose module is off) and completion."""

    steps = OnboardingStepSerializer(many=True, read_only=True)
    completed = serializers.BooleanField(read_only=True)
    completed_at = serializers.DateTimeField(read_only=True, allow_null=True)


class OnboardingUpdateSerializer(serializers.Serializer):
    """`PATCH /onboarding`: exactly one of `confirm`, `skip` or `unskip`.

    A known step the action does not apply to (confirming anything but `profile`, skipping a
    step that is not skippable) is a 422 from the service, not a 400 here.
    """

    confirm = serializers.ChoiceField(choices=OnboardingStepKey.choices, required=False)
    skip = serializers.ChoiceField(choices=OnboardingStepKey.choices, required=False)
    unskip = serializers.ChoiceField(choices=OnboardingStepKey.choices, required=False)

    def validate(self, attrs: dict) -> dict:
        if len([action for action in ACTIONS if action in attrs]) != 1:
            raise serializers.ValidationError("Send exactly one of confirm, skip or unskip.")
        return attrs
