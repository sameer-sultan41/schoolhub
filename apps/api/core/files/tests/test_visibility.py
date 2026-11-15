"""`set_visibility` and the public-reference registry."""

from __future__ import annotations

from unittest import mock
from uuid import UUID, uuid4

from django.test import SimpleTestCase, TestCase

from apps.school_organization.tests.factories import TenantFactory
from core.files import visibility
from core.files.models import File, FileVisibility
from core.files.services import set_visibility
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context


class SetVisibilityTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory()

    def test_flips_visibility_and_persists(self) -> None:
        with tenant_context(self.tenant.id):
            file = FileFactory(tenant=self.tenant)
            set_visibility(file, FileVisibility.PUBLIC)
            self.assertEqual(File.objects.get(id=file.id).visibility, FileVisibility.PUBLIC)
            set_visibility(file, FileVisibility.PRIVATE)
            self.assertEqual(File.objects.get(id=file.id).visibility, FileVisibility.PRIVATE)

    def test_unchanged_visibility_writes_nothing(self) -> None:
        with tenant_context(self.tenant.id):
            file = FileFactory(tenant=self.tenant)
            with mock.patch.object(File, "save") as save:
                set_visibility(file, FileVisibility.PRIVATE)
            save.assert_not_called()

    def test_rejects_unknown_visibility(self) -> None:
        with tenant_context(self.tenant.id):
            file = FileFactory(tenant=self.tenant)
            with self.assertRaises(ValueError):
                set_visibility(file, "world-readable")


class _Claims:
    """A provider that claims a fixed set of ids."""

    def __init__(self, claimed: set[UUID]) -> None:
        self.claimed = claimed

    def __call__(self, ids: set[UUID]) -> set[UUID]:
        return self.claimed & ids


class SyncFileVisibilityTests(TestCase):
    def setUp(self) -> None:
        self.tenant = TenantFactory()
        with tenant_context(self.tenant.id):
            self.kept = FileFactory(tenant=self.tenant)
            self.dropped = FileFactory(tenant=self.tenant, visibility=FileVisibility.PUBLIC)

    def _sync(self, providers: list, ids: list[UUID]) -> None:
        with (
            tenant_context(self.tenant.id),
            mock.patch.object(visibility, "_providers", providers),
        ):
            visibility.sync_file_visibility(ids)

    def _visibility(self, file: File) -> str:
        with tenant_context(self.tenant.id):
            return File.objects.get(id=file.id).visibility

    def test_claimed_file_becomes_public_and_unclaimed_becomes_private(self) -> None:
        self._sync([_Claims({self.kept.id})], [self.kept.id, self.dropped.id])
        self.assertEqual(self._visibility(self.kept), FileVisibility.PUBLIC)
        self.assertEqual(self._visibility(self.dropped), FileVisibility.PRIVATE)

    def test_any_provider_claiming_a_file_keeps_it_public(self) -> None:
        providers = [_Claims(set()), _Claims({self.dropped.id})]
        self._sync(providers, [self.dropped.id])
        self.assertEqual(self._visibility(self.dropped), FileVisibility.PUBLIC)

    def test_provider_claiming_ids_it_was_not_asked_about_is_ignored(self) -> None:
        stray = uuid4()
        self._sync([lambda ids: {stray}], [self.dropped.id])
        self.assertEqual(self._visibility(self.dropped), FileVisibility.PRIVATE)

    def test_no_ids_runs_no_provider(self) -> None:
        provider = mock.Mock(return_value=set())
        self._sync([provider], [])
        provider.assert_not_called()

    def test_another_tenants_file_is_left_alone(self) -> None:
        other = TenantFactory()
        with tenant_context(other.id):
            theirs = FileFactory(tenant=other)
        self._sync([_Claims({theirs.id})], [theirs.id])
        with tenant_context(other.id):
            self.assertEqual(File.objects.get(id=theirs.id).visibility, FileVisibility.PRIVATE)


class RegisterProviderTests(SimpleTestCase):
    def test_registering_twice_keeps_one_entry(self) -> None:
        def provider(ids: set[UUID]) -> set[UUID]:
            return set()

        with mock.patch.object(visibility, "_providers", []) as providers:
            visibility.register_public_reference_provider(provider)
            visibility.register_public_reference_provider(provider)
            self.assertEqual(providers, [provider])
