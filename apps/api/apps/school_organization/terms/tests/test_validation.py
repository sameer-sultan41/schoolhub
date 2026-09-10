"""Service-level tests for `assert_term_window` (module doc §11).

Moved from `tests/test_models.py::DateWindowServiceTests` — the session-overlap
half of that class moved to `academic_sessions/tests/test_lifecycle.py` when
`assert_no_session_overlap` did; this is the other half, following
`assert_term_window` into its own package.
"""

from __future__ import annotations

import datetime

from django.test import TestCase

from apps.school_organization.terms.services import assert_term_window
from apps.school_organization.tests.base import TenantFixtureMixin
from apps.school_organization.tests.factories import AcademicSessionFactory, TermFactory
from core.api.exceptions import DomainRuleViolation
from core.tenancy.context import tenant_context


class TermWindowServiceTests(TenantFixtureMixin, TestCase):
    def test_terms_must_nest_inside_their_session(self) -> None:
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)
            with self.assertRaises(DomainRuleViolation):
                assert_term_window(
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
                assert_term_window(
                    session=session,
                    start_date=datetime.date(2026, 8, 1),
                    end_date=datetime.date(2026, 12, 31),
                )
