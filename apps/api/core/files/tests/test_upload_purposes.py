"""The upload-purpose registry, and the contract that keeps it honest.

The regression these pin: `staff.photo`, `staff.document` and `staff.qualification`
shipped in PR #30 but were never added to the old `settings.FILE_UPLOAD_RULES`
dict, so `POST /api/v1/files` returned 422 for every staff photo, qualification
certificate and staff document — the dashboard tabs existed and could not upload
anything. See core/files/purposes.py's docstring.
"""

from __future__ import annotations

from django.test import SimpleTestCase, TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.tests.factories import TenantFactory, UserFactory, authenticate, grant
from core.api.exceptions import DomainRuleViolation
from core.files.purposes import UploadPurposeRegistry, registry
from core.files.services import assert_upload_allowed


class UploadPurposeRegistryTests(SimpleTestCase):
    def test_register_returns_the_spec_so_callers_can_hold_the_symbol(self) -> None:
        local = UploadPurposeRegistry()
        spec = local.register(
            "demo.thing", "A thing.", mime_types={"application/pdf"}, max_size_bytes=1024
        )
        self.assertEqual(spec.key, "demo.thing")
        self.assertEqual(local.get("demo.thing"), spec)
        self.assertIn("demo.thing", local)

    def test_a_duplicate_key_is_rejected(self) -> None:
        local = UploadPurposeRegistry()
        local.register("demo.thing", "A thing.", mime_types={"text/csv"}, max_size_bytes=1)
        with self.assertRaises(ValueError):
            local.register("demo.thing", "Again.", mime_types={"text/csv"}, max_size_bytes=1)

    def test_a_malformed_key_is_rejected(self) -> None:
        local = UploadPurposeRegistry()
        for key in ("single", "too.many.dots", ".leading", "trailing."):
            with self.subTest(key=key), self.assertRaises(ValueError):
                local.register(key, "x", mime_types={"text/csv"}, max_size_bytes=1)

    def test_empty_limits_are_rejected(self) -> None:
        local = UploadPurposeRegistry()
        with self.assertRaises(ValueError):
            local.register("demo.a", "x", mime_types=set(), max_size_bytes=1)
        with self.assertRaises(ValueError):
            local.register("demo.b", "x", mime_types={"text/csv"}, max_size_bytes=0)

    def test_a_registered_spec_exposes_an_immutable_mime_type_set(self) -> None:
        spec = registry.get("student.photo")
        assert spec is not None
        self.assertIsInstance(spec.mime_types, frozenset)


class UploadPurposeContractTests(TestCase):
    """Every purpose a module actually uses must be one it declared.

    Walks the real `assert_file_usable(..., purpose=...)` call sites by way of the
    module `uploads` modules they now read from: if a module reintroduces a bare
    string literal, its purpose will not be in the registry and `POST /files` will
    422 again — so this asserts the registry covers every purpose the shipped
    modules reference.
    """

    EXPECTED = {
        "student.photo",
        "student.document",
        "guardian.photo",
        "staff.photo",
        "staff.document",
        "staff.qualification",
    }

    def test_every_shipped_module_purpose_is_registered(self) -> None:
        missing = self.EXPECTED - registry.keys()
        self.assertEqual(missing, set(), f"upload purposes used but never declared: {missing}")

    def test_module_services_reference_registered_specs_not_bare_strings(self) -> None:
        from apps.staff_management import uploads as staff_uploads
        from apps.student_management import uploads as student_uploads

        for spec in (
            student_uploads.STUDENT_PHOTO,
            student_uploads.STUDENT_DOCUMENT,
            student_uploads.GUARDIAN_PHOTO,
            staff_uploads.STAFF_PHOTO,
            staff_uploads.STAFF_DOCUMENT,
            staff_uploads.STAFF_QUALIFICATION,
        ):
            with self.subTest(purpose=spec.key):
                self.assertIs(registry.get(spec.key), spec)

    def test_an_unregistered_purpose_is_rejected(self) -> None:
        with self.assertRaises(DomainRuleViolation):
            assert_upload_allowed(purpose="nope.nothing", mime_type="application/pdf", size_bytes=1)


class StaffUploadEndpointTests(APITestCase):
    """The three purposes that used to 422 now reach a pending row."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)
        grant(self.user, "platform.file.create")

    def _post(self, *, purpose: str, mime_type: str, size_bytes: int = 2048):
        return self.client.post(
            "/api/v1/files",
            {
                "original_name": "attachment.pdf",
                "mime_type": mime_type,
                "size_bytes": size_bytes,
                "purpose": purpose,
            },
            format="json",
        )

    def test_staff_photo_document_and_qualification_uploads_are_accepted(self) -> None:
        cases = [
            ("staff.photo", "image/png"),
            ("staff.document", "application/pdf"),
            ("staff.qualification", "application/pdf"),
        ]
        for purpose, mime_type in cases:
            with self.subTest(purpose=purpose):
                response = self._post(purpose=purpose, mime_type=mime_type)
                self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
                self.assertEqual(response.json()["data"]["status"], "pending")

    def test_a_staff_photo_still_rejects_a_pdf(self) -> None:
        response = self._post(purpose="staff.photo", mime_type="application/pdf")
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_staff_document_over_the_limit_is_rejected(self) -> None:
        response = self._post(
            purpose="staff.document", mime_type="application/pdf", size_bytes=11 * 1024 * 1024
        )
        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
