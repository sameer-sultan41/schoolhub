"""`scope_permission`: an export job's declaration, out of its payload and back."""

from __future__ import annotations

from django.test import SimpleTestCase

from core.exports.scope import (
    SCOPE_PERMISSION,
    job_scope_permission,
    scope_permission_payload,
)
from core.rbac.permissions import AnyOf

VIEW = "attendance.report.view"
EXPORT = "attendance.report.export"


class JobScopePermissionTests(SimpleTestCase):
    def test_one_key_is_that_key(self) -> None:
        self.assertEqual(job_scope_permission({SCOPE_PERMISSION: [VIEW]}), VIEW)

    def test_two_keys_are_an_any_of_in_their_order(self) -> None:
        declared = job_scope_permission({SCOPE_PERMISSION: [VIEW, EXPORT]})

        self.assertIsInstance(declared, AnyOf)
        assert isinstance(declared, AnyOf)
        self.assertEqual(declared.keys, (VIEW, EXPORT))

    def test_a_declaration_round_trips_through_the_payload(self) -> None:
        for declared in (VIEW, AnyOf(VIEW, EXPORT)):
            with self.subTest(declared=declared):
                stored = {SCOPE_PERMISSION: scope_permission_payload(declared)}
                back = job_scope_permission(stored)
                self.assertEqual(
                    back.keys if isinstance(back, AnyOf) else (back,),
                    declared.keys if isinstance(declared, AnyOf) else (declared,),
                )

    def test_a_missing_empty_or_malformed_value_is_none(self) -> None:
        """None makes the task fail the job: never a read under no key or every key."""
        for payload in (
            {},
            {SCOPE_PERMISSION: None},
            {SCOPE_PERMISSION: []},
            {SCOPE_PERMISSION: VIEW},  # a bare string, not a list
            {SCOPE_PERMISSION: [VIEW, 3]},
            {SCOPE_PERMISSION: [""]},
            {SCOPE_PERMISSION: [VIEW, None]},
        ):
            with self.subTest(payload=payload):
                self.assertIsNone(job_scope_permission(payload))
