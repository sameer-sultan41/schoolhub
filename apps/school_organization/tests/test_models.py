"""Model constraint and service-rule tests.

The constraints here are the last line of defence for structural integrity, so
they are asserted against the database rather than against serializer behaviour:
a rule that only lives in a serializer is not enforced for the bulk importer,
Celery jobs or the admin.
"""

from __future__ import annotations

import datetime

from django.db import IntegrityError, transaction
from django.test import TestCase

from apps.school_organization import services
from apps.school_organization.models import (
    AcademicSession,
    Campus,
    ClassSubject,
    House,
    SessionStatus,
)
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
from core.api.exceptions import Conflict, DomainRuleViolation
from core.tenancy.context import tenant_context


class TenantFixtureMixin:
    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()


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
        with tenant_context(self.tenant.id):
            with self.assertRaises(IntegrityError):
                ClassSubjectFactory(
                    tenant=self.tenant,
                    academic_session=AcademicSessionFactory(tenant=self.tenant),
                    school_class=ClassFactory(tenant=self.tenant),
                    subject=SubjectFactory(tenant=self.tenant),
                    weekly_periods=0,
                )


class SessionLifecycleServiceTests(TenantFixtureMixin, TestCase):
    def setUp(self) -> None:
        super().setUp()
        self.actor_id = self.tenant.id  # Any UUID; only stored as updated_by.

    def _complete_structure(self) -> AcademicSession:
        campus = CampusFactory(tenant=self.tenant)
        grade = ClassFactory(tenant=self.tenant)
        SectionFactory(tenant=self.tenant, school_class=grade, campus=campus)
        session = AcademicSessionFactory(tenant=self.tenant)
        TermFactory(
            tenant=self.tenant,
            academic_session=session,
            start_date=SESSION_START,
            end_date=SESSION_END,
        )
        return session

    def test_activation_requires_a_complete_structure(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            with self.assertRaises(DomainRuleViolation):
                services.activate_session(session, actor_id=self.actor_id)

    def test_activation_reports_every_gap_at_once(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            errors = services.session_completeness_errors(session)

        self.assertEqual(len(errors), 3)

    def test_activation_makes_the_session_current(self) -> None:
        with tenant_context(self.tenant.id):
            session = self._complete_structure()
            activated = services.activate_session(session, actor_id=self.actor_id)

            self.assertEqual(activated.status, SessionStatus.ACTIVE)
            self.assertTrue(activated.is_current)

    def test_activation_demotes_the_previous_current_session(self) -> None:
        with tenant_context(self.tenant.id):
            incumbent = AcademicSessionFactory(
                tenant=self.tenant,
                is_current=True,
                status=SessionStatus.ACTIVE,
                start_date=datetime.date(2024, 4, 1),
                end_date=datetime.date(2025, 3, 31),
            )
            session = self._complete_structure()
            services.activate_session(session, actor_id=self.actor_id)

            incumbent.refresh_from_db()
            self.assertFalse(incumbent.is_current)

    def test_a_closed_session_cannot_be_reactivated(self) -> None:
        with tenant_context(self.tenant.id):
            session = self._complete_structure()
            services.activate_session(session, actor_id=self.actor_id)
            services.close_session(session, actor_id=self.actor_id)

            with self.assertRaises(Conflict):
                services.activate_session(session, actor_id=self.actor_id)

    def test_only_an_active_session_can_be_closed(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            with self.assertRaises(Conflict):
                services.close_session(session, actor_id=self.actor_id)

    def test_closed_sessions_are_not_writable(self) -> None:
        with tenant_context(self.tenant.id):
            session = self._complete_structure()
            services.activate_session(session, actor_id=self.actor_id)
            closed = services.close_session(session, actor_id=self.actor_id)

            self.assertFalse(closed.is_writable)
            with self.assertRaises(DomainRuleViolation):
                services.assert_session_writable(closed)

    def test_clone_copies_the_curriculum_forward(self) -> None:
        with tenant_context(self.tenant.id):
            source = AcademicSessionFactory(tenant=self.tenant)
            grade = ClassFactory(tenant=self.tenant)
            ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=source,
                school_class=grade,
                subject=SubjectFactory(tenant=self.tenant),
                weekly_periods=5,
            )

            target = services.clone_session(
                source,
                name="2028-29",
                start_date=datetime.date(2028, 4, 1),
                end_date=datetime.date(2029, 3, 31),
                actor_id=self.actor_id,
                tenant_id=self.tenant.id,
            )

            cloned = ClassSubject.objects.filter(academic_session=target)
            self.assertEqual(cloned.count(), 1)
            self.assertEqual(cloned.first().weekly_periods, 5)
            self.assertEqual(target.status, SessionStatus.PLANNED)


class DateWindowServiceTests(TenantFixtureMixin, TestCase):
    def test_sessions_may_not_overlap(self) -> None:
        with tenant_context(self.tenant.id):
            AcademicSessionFactory(tenant=self.tenant)
            with self.assertRaises(DomainRuleViolation):
                services.assert_no_session_overlap(
                    start_date=datetime.date(2026, 6, 1), end_date=datetime.date(2027, 6, 1)
                )

    def test_adjacent_sessions_are_allowed(self) -> None:
        with tenant_context(self.tenant.id):
            AcademicSessionFactory(tenant=self.tenant)
            services.assert_no_session_overlap(
                start_date=datetime.date(2027, 4, 1), end_date=datetime.date(2028, 3, 31)
            )

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
