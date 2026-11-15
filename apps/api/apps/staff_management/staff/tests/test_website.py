"""Website opt-in: `public_teachers` and the staff photo's public visibility."""

from __future__ import annotations

from rest_framework import status

from apps.staff_management.models import EmploymentStatus, Staff
from apps.staff_management.public import public_teachers
from apps.staff_management.tests.base import StaffManagementAPITestCase
from apps.staff_management.tests.factories import DesignationFactory, StaffFactory
from apps.staff_management.visibility import staff_photo_files, sync_staff_photos
from core.files.models import File, FileVisibility
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context


class WebsiteTestBase(StaffManagementAPITestCase):
    def photo(self) -> File:
        with tenant_context(self.tenant.id):
            return FileFactory(tenant=self.tenant, purpose="staff.photo", mime_type="image/png")

    def staff(self, **fields) -> Staff:
        with tenant_context(self.tenant.id):
            return StaffFactory(tenant=self.tenant, campus=self.campus, **fields)

    def visibility(self, file: File) -> str:
        with tenant_context(self.tenant.id):
            return File.objects.get(pk=file.pk).visibility


class PublicTeachersTests(WebsiteTestBase):
    def test_public_teachers_excludes_unflagged_and_inactive(self) -> None:
        listed = self.staff(show_on_website=True, public_bio="Hello", first_name="Zed")
        self.staff(show_on_website=False)
        self.staff(show_on_website=True, employment_status=EmploymentStatus.RESIGNED)
        self.staff(show_on_website=True, employment_status=EmploymentStatus.SUSPENDED)
        with tenant_context(self.tenant.id):
            deleted = StaffFactory(tenant=self.tenant, campus=self.campus, show_on_website=True)
            Staff.objects.filter(pk=deleted.pk).update(deleted_at=listed.created_at)
            rows = public_teachers(10)
        self.assertEqual([row.id for row in rows], [listed.id])
        self.assertEqual(rows[0].bio, "Hello")
        self.assertEqual(rows[0].full_name, "Zed Test")

    def test_on_leave_staff_stay_listed_and_limit_applies(self) -> None:
        self.staff(show_on_website=True, employment_status=EmploymentStatus.ON_LEAVE)
        self.staff(show_on_website=True)
        with tenant_context(self.tenant.id):
            self.assertEqual(len(public_teachers(10)), 2)
            self.assertEqual(len(public_teachers(1)), 1)

    def test_public_queries_are_constant(self) -> None:
        with tenant_context(self.tenant.id):
            designation = DesignationFactory(tenant=self.tenant)
        for _ in range(5):
            self.staff(show_on_website=True, designation=designation)
        with tenant_context(self.tenant.id), self.assertNumQueries(1):
            rows = public_teachers(10)
        self.assertEqual(len(rows), 5)
        self.assertEqual(rows[0].designation, designation.name)


class PhotoVisibilityTests(WebsiteTestBase):
    def test_flag_toggle_sets_photo_visibility(self) -> None:
        self.allow("staff.staff.view", "staff.staff.update")
        photo = self.photo()
        staff = self.staff(photo_file=photo)
        url = f"/api/v1/staff/{staff.pk}"

        on = self.client.patch(url, {"show_on_website": True}, format="json")
        self.assertEqual(on.status_code, status.HTTP_200_OK, on.json())
        self.assertEqual(self.visibility(photo), FileVisibility.PUBLIC)
        self.assertTrue(on.json()["data"]["show_on_website"])

        off = self.client.patch(url, {"show_on_website": False}, format="json")
        self.assertEqual(off.status_code, status.HTTP_200_OK, off.json())
        self.assertEqual(self.visibility(photo), FileVisibility.PRIVATE)

    def test_photo_change_moves_visibility_to_the_new_file(self) -> None:
        self.allow("staff.staff.view", "staff.staff.update")
        old, new = self.photo(), self.photo()
        staff = self.staff(photo_file=old, show_on_website=True)
        with tenant_context(self.tenant.id):
            sync_staff_photos({old.pk})
        self.assertEqual(self.visibility(old), FileVisibility.PUBLIC)

        response = self.client.patch(
            f"/api/v1/staff/{staff.pk}", {"photo_file_id": str(new.pk)}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(self.visibility(old), FileVisibility.PRIVATE)
        self.assertEqual(self.visibility(new), FileVisibility.PUBLIC)

    def test_staff_exit_and_delete_revert_photo_visibility(self) -> None:
        self.allow("staff.staff.view", "staff.staff.update", "staff.staff.delete")
        for action in ("exit", "delete"):
            photo = self.photo()
            staff = self.staff(photo_file=photo, show_on_website=True)
            with tenant_context(self.tenant.id):
                sync_staff_photos({photo.pk})
            self.assertEqual(self.visibility(photo), FileVisibility.PUBLIC)

            if action == "exit":
                response = self.client.post(
                    f"/api/v1/staff/{staff.pk}:exit",
                    {"exit_date": "2026-06-01", "exit_reason": "Resigned."},
                    format="json",
                )
            else:
                response = self.client.delete(f"/api/v1/staff/{staff.pk}")

            self.assertLess(response.status_code, 300, response.content)
            self.assertEqual(self.visibility(photo), FileVisibility.PRIVATE, action)

    def test_provider_ignores_candidates_no_listed_staff_uses(self) -> None:
        used, unused = self.photo(), self.photo()
        self.staff(photo_file=used, show_on_website=True)
        with tenant_context(self.tenant.id):
            self.assertEqual(staff_photo_files({used.pk, unused.pk}), {used.pk})
            self.assertEqual(staff_photo_files(set()), set())
