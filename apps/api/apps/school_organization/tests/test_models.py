"""Model constraint and service-rule tests.

The constraints here are the last line of defence for structural integrity, so
they are asserted against the database rather than against serializer behaviour:
a rule that only lives in a serializer is not enforced for the bulk importer,
Celery jobs or the admin.

Service-rule tests here cover only the functions that stay in the module-root
`services.py` (see that file's docstring for why); functions that moved into a
resource package have their tests alongside them there.
"""

from __future__ import annotations

import datetime

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.school_organization import services
from apps.school_organization.models import Campus, House
from apps.school_organization.tests.base import TenantFixtureMixin
from apps.school_organization.tests.factories import (
    SESSION_END,
    SESSION_START,
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    HouseFactory,
    SectionFactory,
    SubjectFactory,
    TenantFactory,
    TermFactory,
)
from core.api.exceptions import DomainRuleViolation
from core.tenancy.context import tenant_context


class UniquenessConstraintTests(TenantFixtureMixin, TestCase):
    def test_campus_code_is_unique_within_a_tenant(self) -> None:
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, code="NORTH")
            with self.assertRaises(IntegrityError), transaction.atomic():
                CampusFactory(tenant=self.tenant, code="NORTH")

    def test_two_tenants_may_use_the_same_campus_code(self) -> None:
        """Uniqueness is per tenant, and each tenant sees only its own row.

        Asserted inside each tenant's context rather than via ``all_tenants``:
        RLS filters that manager too, so a cross-tenant count would be measuring
        the session GUC, not the constraint.
        """
        other = TenantFactory()
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, code="NORTH")
            self.assertEqual(Campus.objects.filter(code="NORTH").count(), 1)
        with tenant_context(other.id):
            CampusFactory(tenant=other, code="NORTH")
            self.assertEqual(Campus.objects.filter(code="NORTH").count(), 1)

    def test_soft_deleted_campus_releases_its_code(self) -> None:
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant, code="NORTH")
            campus.deleted_at = datetime.datetime.now(tz=datetime.UTC)
            campus.save(update_fields=["deleted_at"])

            # No IntegrityError: the unique index excludes soft-deleted rows.
            CampusFactory(tenant=self.tenant, code="NORTH")

    def test_only_one_primary_campus_per_tenant(self) -> None:
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, is_primary=True)
            with self.assertRaises(IntegrityError), transaction.atomic():
                CampusFactory(tenant=self.tenant, is_primary=True)

    def test_only_one_current_session_per_tenant(self) -> None:
        with tenant_context(self.tenant.id):
            AcademicSessionFactory(tenant=self.tenant, is_current=True)
            with self.assertRaises(IntegrityError), transaction.atomic():
                AcademicSessionFactory(tenant=self.tenant, is_current=True)

    def test_class_level_is_unique_per_tenant(self) -> None:
        with tenant_context(self.tenant.id):
            ClassFactory(tenant=self.tenant, level=6)
            with self.assertRaises(IntegrityError), transaction.atomic():
                ClassFactory(tenant=self.tenant, level=6)

    def test_section_name_is_unique_within_class_and_campus(self) -> None:
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)
            other_campus = CampusFactory(tenant=self.tenant)
            grade = ClassFactory(tenant=self.tenant)
            SectionFactory(tenant=self.tenant, school_class=grade, campus=campus, name="A")

            # Same name at another campus is legitimate.
            SectionFactory(tenant=self.tenant, school_class=grade, campus=other_campus, name="A")

            with self.assertRaises(IntegrityError), transaction.atomic():
                SectionFactory(tenant=self.tenant, school_class=grade, campus=campus, name="A")

    def test_subject_code_is_unique_per_tenant(self) -> None:
        with tenant_context(self.tenant.id):
            SubjectFactory(tenant=self.tenant, code="MATH")
            with self.assertRaises(IntegrityError), transaction.atomic():
                SubjectFactory(tenant=self.tenant, code="MATH")

    def test_campus_agnostic_curriculum_rows_still_collide(self) -> None:
        """NULL campus must not defeat the unique mapping (nulls_distinct=False)."""
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            grade = ClassFactory(tenant=self.tenant)
            subject = SubjectFactory(tenant=self.tenant)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=session,
                school_class=grade,
                subject=subject,
                campus=None,
            )
            with self.assertRaises(IntegrityError), transaction.atomic():
                ClassSubjectFactory(
                    tenant=self.tenant,
                    academic_session=session,
                    school_class=grade,
                    subject=subject,
                    campus=None,
                )

    def test_houses_may_all_omit_their_code(self) -> None:
        with tenant_context(self.tenant.id):
            HouseFactory(tenant=self.tenant, code=None)
            HouseFactory(tenant=self.tenant, code=None)
            self.assertEqual(House.objects.filter(code__isnull=True).count(), 2)


class CheckConstraintTests(TenantFixtureMixin, TestCase):
    def test_session_must_end_after_it_starts(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(IntegrityError):
            AcademicSessionFactory(
                tenant=self.tenant, start_date=SESSION_END, end_date=SESSION_START
            )

    def test_term_must_end_after_it_starts(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            with self.assertRaises(IntegrityError):
                TermFactory(
                    tenant=self.tenant,
                    academic_session=session,
                    start_date=SESSION_END,
                    end_date=SESSION_START,
                )

    def test_curriculum_row_needs_at_least_one_weekly_period(self) -> None:
        with tenant_context(self.tenant.id), self.assertRaises(IntegrityError):
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=AcademicSessionFactory(tenant=self.tenant),
                school_class=ClassFactory(tenant=self.tenant),
                subject=SubjectFactory(tenant=self.tenant),
                weekly_periods=0,
            )


class DateWindowServiceTests(TenantFixtureMixin, TestCase):
    """`assert_term_window` — the session-overlap half of this class moved to
    `academic_sessions/tests/test_lifecycle.py::SessionOverlapServiceTests`
    along with `assert_no_session_overlap` itself. This half stays until
    `assert_term_window` moves into `terms/services.py`.
    """

    def test_terms_must_nest_inside_their_session(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            with self.assertRaises(DomainRuleViolation):
                services.assert_term_window(
                    session=session,
                    start_date=datetime.date(2026, 1, 1),
                    end_date=datetime.date(2026, 6, 1),
                )

    def test_terms_may_not_overlap_siblings(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            TermFactory(
                tenant=self.tenant,
                academic_session=session,
                start_date=datetime.date(2026, 4, 1),
                end_date=datetime.date(2026, 8, 31),
            )
            with self.assertRaises(DomainRuleViolation):
                services.assert_term_window(
                    session=session,
                    start_date=datetime.date(2026, 8, 1),
                    end_date=datetime.date(2026, 12, 31),
                )


class CapacityAndDeletionServiceTests(TenantFixtureMixin, TestCase):
    def test_an_uncapped_section_never_runs_out_of_seats(self) -> None:
        with tenant_context(self.tenant.id):
            section = SectionFactory(
                tenant=self.tenant,
                school_class=ClassFactory(tenant=self.tenant),
                campus=CampusFactory(tenant=self.tenant),
                capacity=None,
            )
            self.assertIsNone(services.section_seats_remaining(section, occupied=500))
            services.assert_section_capacity(section, occupied=500, incoming=10)

    def test_capacity_blocks_an_over_subscribed_enrollment(self) -> None:
        with tenant_context(self.tenant.id):
            section = SectionFactory(
                tenant=self.tenant,
                school_class=ClassFactory(tenant=self.tenant),
                campus=CampusFactory(tenant=self.tenant),
                capacity=30,
            )
            self.assertEqual(services.section_seats_remaining(section, occupied=28), 2)
            services.assert_section_capacity(section, occupied=28, incoming=2)
            with self.assertRaises(DomainRuleViolation):
                services.assert_section_capacity(section, occupied=28, incoming=3)

    def test_capacity_may_not_be_cut_below_current_occupancy(self) -> None:
        with tenant_context(self.tenant.id):
            section = SectionFactory(
                tenant=self.tenant,
                school_class=ClassFactory(tenant=self.tenant),
                campus=CampusFactory(tenant=self.tenant),
                capacity=10,
            )
            with self.assertRaises(DomainRuleViolation):
                services.assert_capacity_not_below_occupancy(section, occupied=12)

    def test_a_class_with_sections_cannot_be_deleted(self) -> None:
        with tenant_context(self.tenant.id):
            grade = ClassFactory(tenant=self.tenant)
            SectionFactory(
                tenant=self.tenant, school_class=grade, campus=CampusFactory(tenant=self.tenant)
            )
            with self.assertRaises(DomainRuleViolation):
                services.assert_deletable(grade)

    def test_an_unreferenced_class_is_deletable(self) -> None:
        with tenant_context(self.tenant.id):
            services.assert_deletable(ClassFactory(tenant=self.tenant))

    def test_soft_deleted_dependents_do_not_block_deletion(self) -> None:
        with tenant_context(self.tenant.id):
            grade = ClassFactory(tenant=self.tenant)
            section = SectionFactory(
                tenant=self.tenant, school_class=grade, campus=CampusFactory(tenant=self.tenant)
            )
            section.deleted_at = datetime.datetime.now(tz=datetime.UTC)
            section.save(update_fields=["deleted_at"])

            services.assert_deletable(grade)


class ConfigurationValidationTests(TestCase):
    def test_iana_timezones_are_accepted(self) -> None:
        self.assertTrue(services.is_valid_timezone("Asia/Karachi"))

    def test_non_iana_timezones_are_rejected(self) -> None:
        self.assertFalse(services.is_valid_timezone("Mars/Olympus_Mons"))
        self.assertFalse(services.is_valid_timezone("PKT"))
