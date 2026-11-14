from django.apps import AppConfig


class StudentManagementConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.student_management"
    label = "student_management"
    verbose_name = "Student Management"

    def ready(self) -> None:
        # Accepting a guardian or student invitation re-checks eligibility (ADR-0033);
        # core cannot import this app, so the checks are registered here.
        from apps.student_management.portal_accounts.services import (
            guardian_invitation_eligible,
            student_invitation_eligible,
        )
        from core.rbac.invitations.eligibility import register_invitation_eligibility
        from core.rbac.models import InvitationKind

        register_invitation_eligibility(InvitationKind.GUARDIAN, guardian_invitation_eligible)
        register_invitation_eligibility(InvitationKind.STUDENT, student_invitation_eligible)
