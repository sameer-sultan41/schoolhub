"""The dashboard summary's wire shape (§16). Read-only: the portal writes nothing."""

from __future__ import annotations

from rest_framework import serializers

from apps.attendance.models import AttendanceStatus


class PortalStudentSerializer(serializers.Serializer):
    id = serializers.UUIDField()
    first_name = serializers.CharField()
    last_name = serializers.CharField()
    admission_number = serializers.CharField()
    class_name = serializers.CharField(allow_null=True)
    section_name = serializers.CharField(allow_null=True)


class AttendanceCardSerializer(serializers.Serializer):
    # The day's derived status; null when nothing is marked today.
    today = serializers.ChoiceField(choices=AttendanceStatus.choices, allow_null=True)
    # Null when the month has no counted day yet.
    month_percentage = serializers.DecimalField(max_digits=4, decimal_places=1, allow_null=True)
    month_present_days = serializers.IntegerField()
    month_counted_days = serializers.IntegerField()


class FeesCardSerializer(serializers.Serializer):
    outstanding_total = serializers.DecimalField(max_digits=12, decimal_places=2)
    outstanding_count = serializers.IntegerField()
    next_due_date = serializers.DateField(allow_null=True)


class LatestResultCardSerializer(serializers.Serializer):
    exam_name = serializers.CharField()
    percentage = serializers.DecimalField(max_digits=5, decimal_places=2)
    grade = serializers.CharField(allow_null=True)
    published_at = serializers.DateTimeField()


class PortalChildSerializer(serializers.Serializer):
    student = PortalStudentSerializer()
    # Each card is null when its module is off or the caller lacks its key.
    attendance = AttendanceCardSerializer(allow_null=True)
    fees = FeesCardSerializer(allow_null=True)
    latest_result = LatestResultCardSerializer(allow_null=True)


class PortalModulesSerializer(serializers.Serializer):
    attendance = serializers.BooleanField()
    fees = serializers.BooleanField()
    examinations = serializers.BooleanField()
    communication = serializers.BooleanField()
    timetable = serializers.BooleanField()


class PortalDashboardSerializer(serializers.Serializer):
    children = PortalChildSerializer(many=True)
    unread_notifications = serializers.IntegerField()
    unread_threads = serializers.IntegerField(allow_null=True)
    modules = PortalModulesSerializer()
