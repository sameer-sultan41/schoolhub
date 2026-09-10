"""API tests for the school-organization endpoints (module doc §16).

Paths are written out literally rather than reversed: the URL shape *is* the
contract (``/api/v1/campuses``, ``/api/v1/academic-sessions/{id}:activate``), and
a test that reverses the name would keep passing after the contract broke.
"""

from __future__ import annotations

from rest_framework import status

from apps.school_organization.models import SubjectType
from apps.school_organization.tests.base import SchoolOrganizationAPITestCase
from apps.school_organization.tests.factories import DepartmentFactory, HouseFactory, SubjectFactory
from core.tenancy.context import tenant_context


class ListOrderingTests(SchoolOrganizationAPITestCase):
    """`?ordering=` on the two structural lists the dashboard renders.

    (Campuses', departments', classes' and sections' own ordering cases moved
    to `campuses/tests/test_endpoints.py`, `departments/tests/test_endpoints.py`,
    `classes/tests/test_endpoints.py` and `sections/tests/test_endpoints.py`
    with the rest of those resources.)

    Every case creates its rows in an order that disagrees with the ordering it
    asserts, so a passing test proves the sort ran rather than that insertion order
    happened to match. `StableOrderingFilter` appends `pk`, so ties resolve by a
    random UUID — no case here leaves two rows tied on the column it sorts by.

    The undeclared-field cases carry as much weight as the sorts. `ordering_fields`
    is an allowlist and DRF drops anything outside it *silently*, so the only way to
    tell an ignored parameter from an honoured one is to give the undeclared column
    values that would visibly reorder the list.
    """

    def _ids(self, url: str) -> list[str]:
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]

    # ------------------------------------------------------------------ subjects

    def test_subjects_sort_by_the_annotated_department_name(self) -> None:
        self.allow("school.subject.view")
        with tenant_context(self.tenant.id):
            science = DepartmentFactory(tenant=self.tenant, name="Science", code="SCI")
            arts = DepartmentFactory(tenant=self.tenant, name="Arts", code="ART")
            algebra = SubjectFactory(
                tenant=self.tenant, name="Algebra", code="ALG", department=science
            )
            drawing = SubjectFactory(
                tenant=self.tenant, name="Drawing", code="DRW", department=arts
            )

        # Arts before Science, the opposite of the subjects' own name order.
        self.assertEqual(
            self._ids("/api/v1/subjects?ordering=department_name"),
            [str(drawing.pk), str(algebra.pk)],
        )
        self.assertEqual(
            self._ids("/api/v1/subjects?ordering=-department_name"),
            [str(algebra.pk), str(drawing.pk)],
        )

    def test_subjects_ignore_an_undeclared_ordering_field(self) -> None:
        self.allow("school.subject.view")
        with tenant_context(self.tenant.id):
            algebra = SubjectFactory(
                tenant=self.tenant,
                name="Algebra",
                code="ALG",
                subject_type=SubjectType.ELECTIVE,
            )
            drawing = SubjectFactory(
                tenant=self.tenant, name="Drawing", code="DRW", subject_type=SubjectType.CORE
            )

        # `subject_type` filters but does not sort; honoured, "core" < "elective"
        # would lead with Drawing.
        self.assertEqual(
            self._ids("/api/v1/subjects?ordering=subject_type"),
            [str(algebra.pk), str(drawing.pk)],
        )

    # -------------------------------------------------------------------- houses

    def test_houses_sort_by_code(self) -> None:
        self.allow("school.house.view")
        with tenant_context(self.tenant.id):
            falcon = HouseFactory(tenant=self.tenant, name="Falcon", code="RED")
            heron = HouseFactory(tenant=self.tenant, name="Heron", code="BLU")

        # `code` inverts the `name` order, so this fails if the parameter is dropped.
        self.assertEqual(self._ids("/api/v1/houses?ordering=code"), [str(heron.pk), str(falcon.pk)])
        self.assertEqual(
            self._ids("/api/v1/houses?ordering=-code"), [str(falcon.pk), str(heron.pk)]
        )
        self.assertEqual(self._ids("/api/v1/houses?ordering=name"), [str(falcon.pk), str(heron.pk)])

    def test_houses_ignore_an_undeclared_ordering_field(self) -> None:
        self.allow("school.house.view")
        with tenant_context(self.tenant.id):
            falcon = HouseFactory(tenant=self.tenant, name="Falcon", code="RED", color="red")
            heron = HouseFactory(tenant=self.tenant, name="Heron", code="BLU", color="blue")

        by_name = [str(falcon.pk), str(heron.pk)]

        # A real-but-undeclared column and a column that does not exist at all are
        # both dropped: 200 in the default order, never a 400 and never a 500.
        self.assertEqual(self._ids("/api/v1/houses?ordering=color"), by_name)
        self.assertEqual(self._ids("/api/v1/houses?ordering=not_a_column"), by_name)


# `/class-subjects` moved to academics in this PR — the route is unchanged but
# the keys and the feature flag are not, so its endpoint tests moved with it to
# `apps/academics/tests/test_api.py::CurriculumEndpointTests`. What stays here is
# the *model* and `map_subject_to_class`, which school_organization still owns
# (see the ownership note in academics/views.py). Testing an endpoint from the
# module that no longer guards it means granting keys this module does not own.


class SchoolSettingsEndpointTests(SchoolOrganizationAPITestCase):
    def test_read_returns_the_tenant_configuration(self) -> None:
        self.allow("school.settings.view")
        response = self.client.get("/api/v1/school-settings")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["currency"], "USD")

    def test_update_requires_the_update_permission(self) -> None:
        self.allow("school.settings.view")
        response = self.client.patch("/api/v1/school-settings", {"locale": "ur"}, format="json")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_update_writes_configuration_and_branding(self) -> None:
        self.allow("school.settings.view", "school.settings.update")
        response = self.client.patch(
            "/api/v1/school-settings",
            {"locale": "ur", "currency": "pkr", "branding": {"primary_color": "#123456"}},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        body = response.json()["data"]
        self.assertEqual(body["currency"], "PKR")
        self.assertEqual(body["branding"], {"primary_color": "#123456"})

        self.tenant.refresh_from_db()
        self.assertEqual(self.tenant.locale, "ur")

    def test_update_rejects_a_non_iana_timezone(self) -> None:
        self.allow("school.settings.view", "school.settings.update")
        response = self.client.patch(
            "/api/v1/school-settings", {"timezone": "Middle/Earth"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)


class PermissionEnforcementTests(SchoolOrganizationAPITestCase):
    def test_an_endpoint_is_closed_without_any_permission(self) -> None:
        response = self.client.get("/api/v1/campuses")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_an_unauthenticated_request_is_rejected(self) -> None:
        self.client.credentials()
        self.client.logout()

        response = self.client.get("/api/v1/campuses")

        self.assertIn(
            response.status_code,
            (status.HTTP_401_UNAUTHORIZED, status.HTTP_403_FORBIDDEN),
        )

    def test_a_view_key_does_not_grant_writes(self) -> None:
        self.allow("school.house.view")
        response = self.client.post("/api/v1/houses", {"name": "Falcon"}, format="json")
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)
