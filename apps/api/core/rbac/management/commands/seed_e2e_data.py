"""Seed the tenants and admin the e2e `live` lane's E2E_LIVE_* defaults expect.

Idempotent — safe to run on every ``seed-dev.sh`` invocation and every CI run of
the e2e-live workflow. Never runs against anything but a local/CI dev database:
it hardcodes dummy credentials that must never reach staging or production. Kept
alongside ``seed_dev_data`` (same app, same imports) rather than under
``apps.school_organization``, even though most of the data it creates lives
there, so both seed commands stay discoverable together.

Password comes from ``E2E_LIVE_ADMIN_PASSWORD`` so it can never drift from
``e2e/src/env.ts``'s zod default, which reads the same env var.
"""

import os
import uuid
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    Section,
    SessionStatus,
    Term,
)
from apps.student_management.models import Gender, Student
from core.rbac.models import RecordScope
from core.rbac.seeding import (
    ensure_admin_user,
    ensure_role_with_permissions,
    ensure_school_owner_role,
    ensure_tenant,
)
from core.tenancy.context import tenant_context
from core.tenancy.models import FeatureFlag, Tenant, TenantFeatureOverride, TenantSettings

E2E_TENANT_SLUG = "e2e-school"
E2E_OTHER_TENANT_SLUG = "e2e-other-school"
E2E_ADMIN_EMAIL = "e2e-admin@schoolhub.test"
# A distinct email, not the same one disambiguated by `school`: the dashboard's login
# form never sends `school` (it derives it from the subdomain, and the dashboard itself
# has no tenant subdomain — see apps/dashboard/src/features/auth/login-form.tsx), so two
# accounts sharing one email across tenants make every browser-driven live-lane login
# genuinely ambiguous, not just theoretically. Confirmed against the real API, not assumed.
E2E_OTHER_ADMIN_EMAIL = "e2e-admin-other@schoolhub.test"
# Dev/CI-only seed data, matches e2e/src/env.ts's own fallback. `or`, not
# `.get(key, default)`: an unset CI secret still sets the env var to an empty
# string via `-e VAR` in the workflow, which `.get` would happily return.
E2E_ADMIN_PASSWORD = os.environ.get("E2E_LIVE_ADMIN_PASSWORD") or "e2e-not-a-real-password"  # noqa: S105

E2E_CAMPUS_CODE = "MAIN"
E2E_CLASS_NAME = "Grade 1"
E2E_SECTION_NAME = "A"
E2E_SESSION_NAME = "E2E Baseline"

# Role-based CUJ identities (student-management). `school_owner` holds every permission,
# which can't prove a narrower role/scope actually gates anything — these two exist so a
# live spec can log in as a real, minimally-privileged identity instead.
#
# `school_admin`, not `admission_staff`: confirmed against the real API that the
# admission->enrollment journey's emergency-contact step needs `students.student.update`
# (apps/student_management/views.py's EmergencyContactViewSet reuses that key, not a
# distinct one), which RECORD_MANAGERS grants to `school_admin` only — `admission_staff`
# holds `students.student.create`/`.view` but genuinely cannot complete this journey
# alone per the shipped permission model. A single `school_admin` doing the whole
# admission->enrollment flow is the more realistic single-actor journey, not a
# simplification of it.
E2E_SCHOOL_ADMIN_EMAIL = "e2e-school-admin@schoolhub.test"
E2E_STUDENT_EMAIL = "e2e-student@schoolhub.test"
# The exact keys apps/student_management/permissions.py grants `school_admin` for this
# journey — not the full registry. Plus the school_organization *.view keys `school_admin`
# also holds via ALL_STAFF there (apps/school_organization/permissions.py) — confirmed
# needed against the real API: the create-student form's Campus select and the Enroll
# dialog's session/class/section selects all call GET on these, and 403 without them, not
# just render empty.
E2E_SCHOOL_ADMIN_PERMISSIONS = [
    "students.student.view",
    "students.student.create",
    "students.student.update",
    "students.enrollment.enroll",
    "students.guardian.view",
    "students.guardian.create",
    "students.document.view",
    "students.document.create",
    "school.campus.view",
    "school.house.view",
    "school.academic-session.view",
    "school.class.view",
    "school.section.view",
]
# The one key restricted principals (student, guardian) may hold at all — auth-and-rbac.md
# §6 rule 4 — scope-narrowed via RecordScope.OWN rather than the grant itself being unsafe.
E2E_STUDENT_PERMISSIONS = ["students.student.view"]

E2E_STUDENT_A_NAME = ("E2E", "Student A")
E2E_STUDENT_B_NAME = ("E2E", "Student B")


class Command(BaseCommand):
    help = (
        "Seed the two tenants and the admin the e2e `live` lane's E2E_LIVE_* env "
        "defaults expect, plus enough baseline school_organization data for the "
        "academic-session activation journey to pass its completeness check."
    )

    @transaction.atomic
    def handle(self, *args, **options):
        tenant = ensure_tenant(E2E_TENANT_SLUG, "E2E School")
        other_tenant = ensure_tenant(E2E_OTHER_TENANT_SLUG, "E2E Other School")

        role = ensure_school_owner_role()
        ensure_admin_user(
            tenant,
            role,
            email=E2E_ADMIN_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="Admin",
        )
        # A distinct email (not the same one disambiguated by `school`) — lets a live spec
        # log in as a real admin of the *other* tenant to prove cross-tenant isolation
        # against a real second identity, not just a placeholder id under the first
        # tenant's own session.
        ensure_admin_user(
            other_tenant,
            role,
            email=E2E_OTHER_ADMIN_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="Admin",
        )

        school_admin_role = ensure_role_with_permissions(
            "school_admin", "School Admin", E2E_SCHOOL_ADMIN_PERMISSIONS
        )
        ensure_admin_user(
            tenant,
            school_admin_role,
            email=E2E_SCHOOL_ADMIN_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="School Admin",
        )
        student_role = ensure_role_with_permissions("student", "Student", E2E_STUDENT_PERMISSIONS)
        student_user = ensure_admin_user(
            tenant,
            student_role,
            email=E2E_STUDENT_EMAIL,
            password=E2E_ADMIN_PASSWORD,
            first_name="E2E",
            last_name="Student",
            scope=RecordScope.OWN,
        )

        with tenant_context(tenant.id):
            TenantSettings.all_tenants.get_or_create(tenant=tenant)
            campus = self._ensure_campus(tenant)
            self._ensure_class_and_section(tenant, campus)
            self._ensure_baseline_session(tenant)
            self._ensure_students_module_enabled(tenant)
            self._ensure_students(tenant, campus, student_user_id=student_user.id)

        # TODO(website-cms): no public-content/CMS backend module exists yet
        # (apps/api/config/api_v1.py routes only core.rbac and
        # apps.school_organization) — there is nothing here to seed real tenant
        # website content into. e2e/tests/live/website-tenant-resolution.spec.ts
        # pins the real current (degraded) behavior instead; revisit this seed
        # once that module ships.

        self.stdout.write(
            self.style.SUCCESS(
                f"Seeded tenant '{tenant.slug}' with admin {E2E_ADMIN_EMAIL}, school admin "
                f"{E2E_SCHOOL_ADMIN_EMAIL}, and student {E2E_STUDENT_EMAIL}; tenant "
                f"'{E2E_OTHER_TENANT_SLUG}' with admin {E2E_OTHER_ADMIN_EMAIL}"
            )
        )

    def _ensure_students_module_enabled(self, tenant: Tenant) -> None:
        """`module.students` defaults off (features.py) — every endpoint 403s with
        `module_disabled` until a tenant is explicitly onboarded onto it, same recipe
        `apps/student_management/tests/factories.py::enable_feature` uses.
        """
        flag = FeatureFlag.objects.get(key="module.students")
        TenantFeatureOverride.objects.get_or_create(
            tenant=tenant,
            feature_flag=flag,
            defaults={"enabled": True, "reason": "e2e live-lane fixture"},
        )

    def _ensure_students(
        self, tenant: Tenant, campus: Campus, *, student_user_id: uuid.UUID
    ) -> None:
        """Two baseline students for the record-scope CUJ: "A" is what the seeded
        `student`-role user (`user_id=student_user_id`) must be able to see via
        `RecordScope.OWN`; "B" has no linked user and is what that same user must get a
        404 on — proving the scope filters, not just the permission key.
        """
        Student.objects.get_or_create(
            tenant=tenant,
            user_id=student_user_id,
            defaults={
                "admission_number": "E2E-STUDENT-A",
                "first_name": E2E_STUDENT_A_NAME[0],
                "last_name": E2E_STUDENT_A_NAME[1],
                "date_of_birth": "2015-06-01",
                "gender": Gender.UNSPECIFIED,
                "campus": campus,
                "admission_date": "2026-01-01",
            },
        )
        Student.objects.get_or_create(
            tenant=tenant,
            admission_number="E2E-STUDENT-B",
            defaults={
                "first_name": E2E_STUDENT_B_NAME[0],
                "last_name": E2E_STUDENT_B_NAME[1],
                "date_of_birth": "2016-06-01",
                "gender": Gender.UNSPECIFIED,
                "campus": campus,
                "admission_date": "2026-01-01",
            },
        )

    def _ensure_campus(self, tenant: Tenant) -> Campus:
        campus, _ = Campus.objects.get_or_create(
            tenant=tenant,
            code=E2E_CAMPUS_CODE,
            defaults={"name": "Main Campus", "is_primary": True, "is_active": True},
        )
        return campus

    def _ensure_class_and_section(self, tenant: Tenant, campus: Campus) -> None:
        school_class, _ = Class.objects.get_or_create(
            tenant=tenant,
            name=E2E_CLASS_NAME,
            defaults={"level": 1, "is_active": True},
        )
        Section.objects.get_or_create(
            tenant=tenant,
            school_class=school_class,
            campus=campus,
            name=E2E_SECTION_NAME,
            defaults={"capacity": 30, "is_active": True},
        )

    def _ensure_baseline_session(self, tenant: Tenant) -> None:
        if AcademicSession.objects.filter(tenant=tenant, name=E2E_SESSION_NAME).exists():
            return

        today = timezone.now().date()
        start_date = today - timedelta(days=30)
        end_date = start_date + timedelta(days=364)

        session = AcademicSession.objects.create(
            tenant=tenant,
            name=E2E_SESSION_NAME,
            start_date=start_date,
            end_date=end_date,
            status=SessionStatus.ACTIVE,
            is_current=True,
        )
        Term.objects.create(
            tenant=tenant,
            academic_session=session,
            name="Full Year",
            sequence=1,
            start_date=start_date,
            end_date=end_date,
        )
