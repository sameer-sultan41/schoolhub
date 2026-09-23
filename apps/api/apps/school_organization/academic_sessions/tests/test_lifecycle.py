"""Service-level tests for the academic-session lifecycle (module doc §7).

Model-constraint tests for `AcademicSession` (uniqueness, the end-after-start
check) stay in the app-root `tests/test_models.py` — this file is
service-behaviour only, split out because `activate`/`close`/`clone` moved to
`academic_sessions/services/` in this package.
"""

from __future__ import annotations

import datetime

from django.test import TestCase

from apps.school_organization.academic_sessions.services.activate import activate_session
from apps.school_organization.academic_sessions.services.clone import clone_session
from apps.school_organization.academic_sessions.services.close import close_session
from apps.school_organization.academic_sessions.services.validate import (
    assert_no_session_overlap,
    session_completeness_errors,
)
from apps.school_organization.models import AcademicSession, ClassSubject, SessionStatus
from apps.school_organization.services import assert_session_writable
from apps.school_organization.tests.base import TenantFixtureMixin
from apps.school_organization.tests.factories import (
    SESSION_END,
    SESSION_START,
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    ClassSubjectFactory,
    SectionFactory,
    SubjectFactory,
    TermFactory,
)
from core.api.exceptions import Conflict, DomainRuleViolation
from core.tenancy.context import tenant_context


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
                activate_session(session, actor_id=self.actor_id)

    def test_activation_reports_every_gap_at_once(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            errors = session_completeness_errors(session)

        self.assertEqual(len(errors), 3)

    def test_activation_makes_the_session_current(self) -> None:
        with tenant_context(self.tenant.id):
            session = self._complete_structure()
            activated = activate_session(session, actor_id=self.actor_id)

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
            activate_session(session, actor_id=self.actor_id)

            incumbent.refresh_from_db()
            self.assertFalse(incumbent.is_current)

    def test_a_closed_session_cannot_be_reactivated(self) -> None:
        with tenant_context(self.tenant.id):
            session = self._complete_structure()
            activate_session(session, actor_id=self.actor_id)
            close_session(session, actor_id=self.actor_id)

            with self.assertRaises(Conflict):
                activate_session(session, actor_id=self.actor_id)

    def test_only_an_active_session_can_be_closed(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            with self.assertRaises(Conflict):
                close_session(session, actor_id=self.actor_id)

    def test_closed_sessions_are_not_writable(self) -> None:
        with tenant_context(self.tenant.id):
            session = self._complete_structure()
            activate_session(session, actor_id=self.actor_id)
            closed = close_session(session, actor_id=self.actor_id)

            self.assertFalse(closed.is_writable)
            with self.assertRaises(DomainRuleViolation):
                assert_session_writable(closed)

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

            target = clone_session(
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


class SessionOverlapServiceTests(TenantFixtureMixin, TestCase):
    """`assert_no_session_overlap` — the other half of the old `DateWindowServiceTests`.

    Term-window tests (the other half of that class) are in
    `terms/tests/test_validation.py::TermWindowServiceTests`, alongside
    `assert_term_window` itself.
    """

    def test_sessions_may_not_overlap(self) -> None:
        with tenant_context(self.tenant.id):
            AcademicSessionFactory(tenant=self.tenant)
            with self.assertRaises(DomainRuleViolation):
                assert_no_session_overlap(
                    start_date=datetime.date(2026, 6, 1), end_date=datetime.date(2027, 6, 1)
                )

    def test_adjacent_sessions_are_allowed(self) -> None:
        with tenant_context(self.tenant.id):
            AcademicSessionFactory(tenant=self.tenant)
            assert_no_session_overlap(
                start_date=datetime.date(2027, 4, 1), end_date=datetime.date(2028, 3, 31)
            )
