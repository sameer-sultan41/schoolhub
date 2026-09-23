"""Serializers for the StudentTransfer resource.

Shared helpers (``_fk``, ``READ_ONLY_FIELDS``) stay in the app root — see
docs/03-modules/student-management.md §20's file-per-action package layout.
"""

from __future__ import annotations

from rest_framework import serializers

from apps.school_organization.models import Campus, Section
from apps.student_management.models import Student, StudentTransfer
from apps.student_management.serializers import READ_ONLY_FIELDS, _fk


class StudentTransferSerializer(serializers.ModelSerializer):
    student_id = _fk(Student, source="student")
    from_campus_id = _fk(Campus, source="from_campus", required=False, allow_null=True)
    to_campus_id = _fk(Campus, source="to_campus", required=False, allow_null=True)

    class Meta:
        model = StudentTransfer
        fields = (
            "id",
            "student_id",
            "transfer_type",
            "from_campus_id",
            "to_campus_id",
            "external_school_name",
            "reason",
            "status",
            "effective_date",
            "decided_by",
            "decided_at",
            "certificate_document_id",
            "created_at",
            "updated_at",
        )
        # status/decided_by/decided_at/certificate_document_id move only
        # through the :approve/:reject/:complete colon-actions.
        read_only_fields = (
            *READ_ONLY_FIELDS,
            "status",
            "decided_by",
            "decided_at",
            "certificate_document_id",
        )


class TransferCompleteRequestSerializer(serializers.Serializer):
    """`section_id` is required only for an inter-campus transfer — see

    transfers.services.complete_transfer, which raises a field-specific error
    when it is missing for that type rather than this serializer guessing at a
    conditional-required rule.
    """

    section_id = _fk(Section, source="section", required=False, allow_null=True)
