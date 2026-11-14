"""Graduation ends a student's portal account (ADR-0033).

Executing a `graduated` decision closes the source enrollment and leaves
`Student.status` as it is; the closed enrollment is what ends eligibility, and promotions
calls `student_management.services.close_graduated_portal_accounts` right after closing it.
"""

from __future__ import annotations

from rest_framework import status
from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken
from rest_framework_simplejwt.tokens import RefreshToken

from apps.academics.promotions import services
from apps.academics.promotions.tests.test_promotion import PREPARE_KEYS, PromotionTestCase
from apps.academics.tests.factories import SectionFactory, authenticate
from apps.student_management.models import EnrollmentStatus, StudentEnrollment, StudentStatus
from apps.student_management.tests.factories import (
    EmergencyContactFactory,
    GuardianFactory,
    StudentEnrollmentFactory,
    StudentFactory,
    StudentGuardianFactory,
)
from apps.student_management.tests.portal_helpers import portal_account
from core.audit.models import AuditLog
from core.tenancy.context import tenant_context


class GraduationPortalTests(PromotionTestCase):
    def test_graduation_deactivates(self) -> None:
        self.allow(*PREPARE_KEYS)
        with tenant_context(self.tenant.id):
            # In the top class, so the default proposal graduates them.
            graduate = StudentFactory(tenant=self.tenant, campus=self.campus)
            guardian = GuardianFactory(tenant=self.tenant)
            StudentGuardianFactory(tenant=self.tenant, student=graduate, guardian=guardian)
            EmergencyContactFactory(tenant=self.tenant, student=graduate)
            enrollment = StudentEnrollmentFactory(
                tenant=self.tenant,
                student=graduate,
                academic_session=self.session,
                school_class=self.next_class,
                section=SectionFactory(
                    tenant=self.tenant, school_class=self.next_class, campus=self.campus
                ),
            )
            student_user = portal_account(graduate)
            guardian_user = portal_account(guardian)
        tokens = [RefreshToken.for_user(user)["jti"] for user in (student_user, guardian_user)]

        batch_id = self.create_batch(school_class=self.next_class)
        self.assertEqual(self.transition(batch_id, "submit").status_code, status.HTTP_200_OK)
        authenticate(self.client, self.second_user("academics.promotion.approve"))
        self.assertEqual(self.transition(batch_id, "approve").status_code, status.HTTP_200_OK)

        report = services.execute_batch(
            batch_id=batch_id, tenant_id=self.tenant.id, actor_id=self.user.pk
        )

        self.assertEqual(report["graduated"], [{"student_id": str(graduate.pk)}], report)
        with tenant_context(self.tenant.id):
            graduate.refresh_from_db()
            enrollment = StudentEnrollment.objects.get(pk=enrollment.pk)
        # Graduation itself is unchanged: the enrollment closes, the status stays.
        self.assertEqual(enrollment.status, EnrollmentStatus.GRADUATED)
        self.assertEqual(graduate.status, StudentStatus.ACTIVE)
        for user in (student_user, guardian_user):
            with self.subTest(user=user.email):
                user.refresh_from_db()
                self.assertFalse(user.is_active)
                self.assertTrue(
                    AuditLog.objects.filter(
                        action="auth.account.deactivated", resource_id=user.pk
                    ).exists()
                )
        self.assertEqual(BlacklistedToken.objects.filter(token__jti__in=tokens).count(), 2)
