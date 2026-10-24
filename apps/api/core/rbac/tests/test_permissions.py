"""`HasPermissionKey` and the `AnyOf` declaration (docs/decisions/0027)."""

from __future__ import annotations

from types import SimpleNamespace
from unittest import mock

from django.core.exceptions import ImproperlyConfigured
from django.test import SimpleTestCase

from core.rbac.permissions import AnyOf, HasPermissionKey, declared_keys

APPROVE = "timetable.substitution.approve"
CREATE = "timetable.substitution.create"
VIEW = "timetable.timetable.view"


def request_for(*keys: str, authenticated: bool = True):
    user = SimpleNamespace(pk="u1", is_authenticated=authenticated)
    return SimpleNamespace(user=user, method="POST", _keys=frozenset(keys))


def check(view, request) -> bool:
    with mock.patch("core.rbac.permissions.effective_permission_keys") as keys:
        keys.return_value = request._keys
        return HasPermissionKey().has_permission(request, view)


class AnyOfTests(SimpleTestCase):
    def test_it_needs_at_least_one_key(self) -> None:
        with self.assertRaises(ImproperlyConfigured):
            AnyOf()

    def test_it_rejects_an_empty_or_non_string_key(self) -> None:
        for bad in ("", None, 3):
            with self.subTest(bad=bad), self.assertRaises(ImproperlyConfigured):
                AnyOf(APPROVE, bad)  # type: ignore[arg-type]

    def test_declared_keys_reads_a_key_or_an_any_of_and_nothing_else(self) -> None:
        self.assertEqual(declared_keys(VIEW), (VIEW,))
        self.assertEqual(declared_keys(AnyOf(APPROVE, CREATE)), (APPROVE, CREATE))
        for bad in ((APPROVE, CREATE), [APPROVE], None):
            with self.subTest(bad=bad), self.assertRaises(ImproperlyConfigured):
                declared_keys(bad)  # type: ignore[arg-type]


class HasPermissionKeyTests(SimpleTestCase):
    def view(self, **attrs):
        # A view that also declares the resource's read key, so a fall-back would show.
        return SimpleNamespace(action="cancel", required_permission=VIEW, **attrs)

    def test_a_single_key_declaration_behaves_as_before(self) -> None:
        view = self.view(required_permission_map={"cancel": APPROVE})

        self.assertTrue(check(view, request_for(APPROVE)))
        self.assertFalse(check(view, request_for(VIEW)))

    def test_an_any_of_admits_a_holder_of_either_key(self) -> None:
        view = self.view(required_permission_map={"cancel": AnyOf(APPROVE, CREATE)})

        self.assertTrue(check(view, request_for(APPROVE)))
        self.assertTrue(check(view, request_for(CREATE)))

    def test_an_any_of_refuses_a_holder_of_neither_key_even_with_the_view_key(self) -> None:
        view = self.view(required_permission_map={"cancel": AnyOf(APPROVE, CREATE)})

        self.assertFalse(check(view, request_for(VIEW)))
        self.assertFalse(check(view, request_for()))

    def test_an_any_of_refuses_an_anonymous_caller(self) -> None:
        view = self.view(required_permission_map={"cancel": AnyOf(APPROVE, CREATE)})

        self.assertFalse(check(view, request_for(APPROVE, authenticated=False)))

    def test_an_empty_map_entry_refuses_everyone_instead_of_falling_back(self) -> None:
        view = self.view(required_permission_map={"cancel": ""})

        self.assertFalse(check(view, request_for(VIEW)))

    def test_an_action_missing_from_the_map_still_uses_the_resource_key(self) -> None:
        view = self.view(required_permission_map={"approve": APPROVE})

        self.assertTrue(check(view, request_for(VIEW)))
