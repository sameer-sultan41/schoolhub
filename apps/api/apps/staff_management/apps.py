from django.apps import AppConfig


class StaffManagementConfig(AppConfig):
    default_auto_field = "django.db.models.BigAutoField"
    name = "apps.staff_management"
    label = "staff_management"
    verbose_name = "Staff Management"

    def ready(self) -> None:
        # Accepting a staff invitation re-checks the person has not exited since it was
        # sent (ADR-0033); core cannot import this app, so the check is registered here.
        from apps.staff_management.staff.services.invite import staff_invitation_eligible
        from core.rbac.invitations.eligibility import register_invitation_eligibility
        from core.rbac.models import InvitationKind

        register_invitation_eligibility(InvitationKind.STAFF, staff_invitation_eligible)

        from apps.staff_management.visibility import register_providers

        # Tell core.files which staff photos the website keeps public (ADR-0013).
        register_providers()
