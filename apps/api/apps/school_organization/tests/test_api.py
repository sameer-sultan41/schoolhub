"""API tests for the school-organization endpoints (module doc §16).

Paths are written out literally rather than reversed: the URL shape *is* the
contract (``/api/v1/campuses``, ``/api/v1/academic-sessions/{id}:activate``), and
a test that reverses the name would keep passing after the contract broke.
"""

from __future__ import annotations

import datetime

from rest_framework import status
from rest_framework.test import APITestCase

from apps.school_organization.models import (
    AcademicSession,
    Campus,
    ClassSubject,
    Section,
    SessionStatus,
    SubjectType,
)
from apps.school_organization.tests.factories import (
    SESSION_END,
    SESSION_START,
    AcademicSessionFactory,
    CampusFactory,
    ClassFactory,
    DepartmentFactory,
    HouseFactory,
    SectionFactory,
    SubjectFactory,
    TenantFactory,
    TermFactory,
    UserFactory,
    authenticate,
    grant,
)
from core.tenancy.context import tenant_context


class SchoolOrganizationAPITestCase(APITestCase):
    """Base fixture: one tenant, one authenticated staff user, no permissions yet."""

    def setUp(self) -> None:
        super().setUp()
        self.tenant = TenantFactory()
        self.user = UserFactory(tenant=self.tenant)
        authenticate(self.client, self.user)

    def allow(self, *permission_keys: str) -> None:
        grant(self.user, *permission_keys)


class CampusEndpointTests(SchoolOrganizationAPITestCase):
    def test_create_requires_the_create_permission(self) -> None:
        self.allow("school.campus.view")
        response = self.client.post(
            "/api/v1/campuses", {"name": "North Campus", "code": "north"}, format="json"
        )
        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_create_normalizes_the_code_and_stamps_the_tenant(self) -> None:
        self.allow("school.campus.view", "school.campus.create")
        response = self.client.post(
            "/api/v1/campuses",
            {"name": "North Campus", "code": " north ", "timezone": "Asia/Karachi"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        self.assertEqual(response.json()["data"]["code"], "NORTH")

        with tenant_context(self.tenant.id):
            campus = Campus.objects.get(code="NORTH")
        self.assertEqual(campus.tenant_id, self.tenant.id)
        self.assertEqual(campus.created_by, self.user.pk)

    def test_create_rejects_a_non_iana_timezone(self) -> None:
        self.allow("school.campus.view", "school.campus.create")
        response = self.client.post(
            "/api/v1/campuses",
            {"name": "North", "code": "N1", "timezone": "PKT"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertEqual(response.json()["error"]["code"], "validation_error")

    def test_list_is_filtered_by_is_active(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, is_active=True)
            CampusFactory(tenant=self.tenant, is_active=False)

        response = self.client.get("/api/v1/campuses?is_active=true")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(len(response.json()["data"]), 1)

    def test_list_excludes_soft_deleted_rows(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)
            campus.deleted_at = datetime.datetime.now(tz=datetime.UTC)
            campus.save(update_fields=["deleted_at"])

        response = self.client.get("/api/v1/campuses")

        self.assertEqual(response.json()["data"], [])

    def test_promoting_a_primary_campus_demotes_the_incumbent(self) -> None:
        self.allow("school.campus.view", "school.campus.create")
        with tenant_context(self.tenant.id):
            incumbent = CampusFactory(tenant=self.tenant, is_primary=True)

        response = self.client.post(
            "/api/v1/campuses",
            {"name": "South", "code": "SOUTH", "is_primary": True},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        incumbent.refresh_from_db()
        self.assertFalse(incumbent.is_primary)

    def test_delete_soft_deletes(self) -> None:
        self.allow("school.campus.view", "school.campus.delete")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)

        response = self.client.delete(f"/api/v1/campuses/{campus.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        campus.refresh_from_db()
        self.assertIsNotNone(campus.deleted_at)

    def test_delete_is_blocked_while_dependents_exist(self) -> None:
        self.allow("school.campus.view", "school.campus.delete")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant)
            SectionFactory(
                tenant=self.tenant, campus=campus, school_class=ClassFactory(tenant=self.tenant)
            )

        response = self.client.delete(f"/api/v1/campuses/{campus.pk}")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        campus.refresh_from_db()
        self.assertIsNone(campus.deleted_at)


class SectionEndpointTests(SchoolOrganizationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant)
            self.grade = ClassFactory(tenant=self.tenant)

    def test_create_uses_the_documented_class_id_field(self) -> None:
        self.allow("school.section.view", "school.section.create")
        response = self.client.post(
            "/api/v1/sections",
            {
                "class_id": str(self.grade.pk),
                "campus_id": str(self.campus.pk),
                "name": "A",
                "capacity": 30,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        body = response.json()["data"]
        self.assertEqual(body["class_id"], str(self.grade.pk))

        with tenant_context(self.tenant.id):
            self.assertTrue(Section.objects.filter(school_class=self.grade).exists())

    def test_create_rejects_a_zero_capacity(self) -> None:
        self.allow("school.section.view", "school.section.create")
        response = self.client.post(
            "/api/v1/sections",
            {
                "class_id": str(self.grade.pk),
                "campus_id": str(self.campus.pk),
                "name": "A",
                "capacity": 0,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_create_rejects_an_inactive_class(self) -> None:
        self.allow("school.section.view", "school.section.create")
        with tenant_context(self.tenant.id):
            self.grade.is_active = False
            self.grade.save(update_fields=["is_active"])

        response = self.client.post(
            "/api/v1/sections",
            {"class_id": str(self.grade.pk), "campus_id": str(self.campus.pk), "name": "A"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)

    def test_list_filters_by_campus(self) -> None:
        self.allow("school.section.view")
        with tenant_context(self.tenant.id):
            other_campus = CampusFactory(tenant=self.tenant)
            SectionFactory(tenant=self.tenant, campus=self.campus, school_class=self.grade)
            SectionFactory(tenant=self.tenant, campus=other_campus, school_class=self.grade)

        response = self.client.get(f"/api/v1/sections?campus_id={self.campus.pk}")

        self.assertEqual(len(response.json()["data"]), 1)


class AcademicSessionEndpointTests(SchoolOrganizationAPITestCase):
    def _complete_structure(self) -> AcademicSession:
        with tenant_context(self.tenant.id):
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

    def test_status_cannot_be_set_through_a_plain_patch(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.update")
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)

        response = self.client.patch(
            f"/api/v1/academic-sessions/{session.pk}",
            {"status": SessionStatus.ACTIVE, "is_current": True},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        session.refresh_from_db()
        self.assertEqual(session.status, SessionStatus.PLANNED)
        self.assertFalse(session.is_current)

    def test_create_rejects_overlapping_dates(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.create")
        with tenant_context(self.tenant.id):
            AcademicSessionFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/academic-sessions",
            {"name": "Overlapping", "start_date": "2026-06-01", "end_date": "2027-06-01"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_activate_requires_its_own_permission(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.update")
        session = self._complete_structure()

        response = self.client.post(f"/api/v1/academic-sessions/{session.pk}:activate")

        self.assertEqual(response.status_code, status.HTTP_403_FORBIDDEN)

    def test_activate_rejects_an_incomplete_structure(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.activate")
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)

        response = self.client.post(f"/api/v1/academic-sessions/{session.pk}:activate")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        session.refresh_from_db()
        self.assertEqual(session.status, SessionStatus.PLANNED)

    def test_activate_flips_the_session_current(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.activate")
        session = self._complete_structure()

        response = self.client.post(f"/api/v1/academic-sessions/{session.pk}:activate")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        self.assertEqual(response.json()["data"]["status"], SessionStatus.ACTIVE)
        session.refresh_from_db()
        self.assertTrue(session.is_current)

    def test_close_locks_the_session(self) -> None:
        self.allow(
            "school.academic-session.view",
            "school.academic-session.activate",
            "school.academic-session.close",
        )
        session = self._complete_structure()
        self.client.post(f"/api/v1/academic-sessions/{session.pk}:activate")

        response = self.client.post(f"/api/v1/academic-sessions/{session.pk}:close")

        self.assertEqual(response.status_code, status.HTTP_200_OK)
        session.refresh_from_db()
        self.assertEqual(session.status, SessionStatus.CLOSED)
        self.assertFalse(session.is_current)

    def test_closing_a_planned_session_is_a_conflict(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.close")
        with tenant_context(self.tenant.id):
            session = AcademicSessionFactory(tenant=self.tenant)

        response = self.client.post(f"/api/v1/academic-sessions/{session.pk}:close")

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_clone_copies_the_curriculum_into_a_new_session(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.create")
        with tenant_context(self.tenant.id):
            source = AcademicSessionFactory(tenant=self.tenant)
            grade = ClassFactory(tenant=self.tenant)
            subject = SubjectFactory(tenant=self.tenant)
            ClassSubject.objects.create(
                tenant=self.tenant,
                academic_session=source,
                school_class=grade,
                subject=subject,
                weekly_periods=6,
            )

        response = self.client.post(
            f"/api/v1/academic-sessions/{source.pk}:clone",
            {"name": "2028-29", "start_date": "2028-04-01", "end_date": "2029-03-31"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)
        target_id = response.json()["data"]["id"]

        with tenant_context(self.tenant.id):
            cloned = ClassSubject.objects.filter(academic_session_id=target_id)
            self.assertEqual(cloned.count(), 1)
            self.assertEqual(cloned.first().weekly_periods, 6)


class TermEndpointTests(SchoolOrganizationAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.session = AcademicSessionFactory(tenant=self.tenant)

    def test_create_rejects_dates_outside_the_session_window(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.create")
        response = self.client.post(
            "/api/v1/terms",
            {
                "academic_session_id": str(self.session.pk),
                "name": "Term 1",
                "sequence": 1,
                "start_date": "2025-01-01",
                "end_date": "2025-06-01",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_create_accepts_a_term_inside_the_window(self) -> None:
        self.allow("school.academic-session.view", "school.academic-session.create")
        response = self.client.post(
            "/api/v1/terms",
            {
                "academic_session_id": str(self.session.pk),
                "name": "Term 1",
                "sequence": 1,
                "start_date": "2026-04-01",
                "end_date": "2026-08-31",
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED)

    def test_list_filters_by_session(self) -> None:
        self.allow("school.academic-session.view")
        with tenant_context(self.tenant.id):
            TermFactory(tenant=self.tenant, academic_session=self.session)

        response = self.client.get(f"/api/v1/terms?academic_session_id={self.session.pk}")

        self.assertEqual(len(response.json()["data"]), 1)


class ListOrderingTests(SchoolOrganizationAPITestCase):
    """`?ordering=` on the six structural lists the dashboard renders.

    Every case creates its rows in an order that disagrees with the ordering it
    asserts, so a passing test proves the sort ran rather than that insertion order
    happened to match. `StableOrderingFilter` appends `pk`, so ties resolve by a
    random UUID — no case here leaves two rows tied on the column it sorts by.

    The undeclared-field cases carry as much weight as the sorts. `ordering_fields`
    is an allowlist and DRF drops anything outside it *silently*, so the only way to
    tell an ignored parameter from an honoured one is to give the undeclared column
    values that would visibly reorder the list. `campus__name` is in here
    deliberately: a `__` traversal must be dropped rather than honoured, because
    `scope_queryset` hands OWN/ASSIGNED principals a `.distinct()` queryset and
    Postgres rejects `SELECT DISTINCT` ordered by a joined column.
    """

    def _ids(self, url: str) -> list[str]:
        response = self.client.get(url)
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["id"] for row in response.json()["data"]]

    # ------------------------------------------------------------------ campuses

    def test_campuses_sort_by_name(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            east = CampusFactory(tenant=self.tenant, name="East", code="EAST")
            south = CampusFactory(tenant=self.tenant, name="South", code="SOUTH")

        ascending = [str(east.pk), str(north.pk), str(south.pk)]

        self.assertEqual(self._ids("/api/v1/campuses?ordering=name"), ascending)
        self.assertEqual(self._ids("/api/v1/campuses?ordering=-name"), ascending[::-1])

    def test_campuses_sort_by_the_flag_columns(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            flagship = CampusFactory(
                tenant=self.tenant, name="Flagship", code="FLAG", is_primary=True
            )
            closed = CampusFactory(
                tenant=self.tenant, name="Closed", code="CLOSED", is_active=False
            )

        # false sorts before true, so ascending `is_active` leads with the closed
        # campus and descending `is_primary` leads with the flagship.
        self.assertEqual(
            self._ids("/api/v1/campuses?ordering=is_active"), [str(closed.pk), str(flagship.pk)]
        )
        self.assertEqual(
            self._ids("/api/v1/campuses?ordering=-is_primary"), [str(flagship.pk), str(closed.pk)]
        )

    def test_campuses_ignore_an_undeclared_ordering_field(self) -> None:
        self.allow("school.campus.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North", code="N", timezone="Asia/Aden")
            east = CampusFactory(tenant=self.tenant, name="East", code="E", timezone="Europe/Rome")

        # `timezone` is a real column and would put North first if it sorted. It is
        # not in `ordering_fields`, so the list stays in the view's default `name`
        # order — a 200 in the wrong order is the failure this guards against, not
        # a 400.
        self.assertEqual(
            self._ids("/api/v1/campuses?ordering=timezone"), [str(east.pk), str(north.pk)]
        )

    # ---------------------------------------------------------------- departments

    def test_departments_sort_by_the_annotated_campus_name(self) -> None:
        self.allow("school.department.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            east = CampusFactory(tenant=self.tenant, name="East", code="EAST")
            arts = DepartmentFactory(tenant=self.tenant, name="Arts", code="ART", campus=north)
            science = DepartmentFactory(tenant=self.tenant, name="Science", code="SCI", campus=east)
            shared = DepartmentFactory(tenant=self.tenant, name="Admin", code="ADM")

        # `campus_name` is the annotation, not `campus__name`. Campus order (East,
        # North) is the opposite of the departments' own name order, and `shared`
        # spans every campus — a NULL, which Postgres sorts last ascending and
        # first descending.
        self.assertEqual(
            self._ids("/api/v1/departments?ordering=campus_name"),
            [str(science.pk), str(arts.pk), str(shared.pk)],
        )
        self.assertEqual(
            self._ids("/api/v1/departments?ordering=-campus_name"),
            [str(shared.pk), str(arts.pk), str(science.pk)],
        )

    def test_departments_ignore_an_undeclared_or_traversing_ordering_field(self) -> None:
        self.allow("school.department.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            east = CampusFactory(tenant=self.tenant, name="East", code="EAST")
            arts = DepartmentFactory(
                tenant=self.tenant, name="Arts", code="ART", campus=north, description="Zulu"
            )
            science = DepartmentFactory(
                tenant=self.tenant, name="Science", code="SCI", campus=east, description="Alpha"
            )

        by_name = [str(arts.pk), str(science.pk)]

        # Both would lead with Science if they sorted: `description` is a real
        # column outside the allowlist, and `campus__name` is the relation
        # traversal `ordering_fields` must never contain. Dropping the traversal is
        # what keeps a scoped principal's `SELECT DISTINCT` from raising
        # ProgrammingError.
        self.assertEqual(self._ids("/api/v1/departments?ordering=description"), by_name)
        self.assertEqual(self._ids("/api/v1/departments?ordering=campus__name"), by_name)

    # ------------------------------------------------------------------- classes

    def test_classes_sort_by_level_and_name(self) -> None:
        self.allow("school.class.view")
        with tenant_context(self.tenant.id):
            ten = ClassFactory(tenant=self.tenant, name="Grade 10", code="G10", level=10)
            two = ClassFactory(tenant=self.tenant, name="Grade 2", code="G2", level=2)

        # `level` is the promotion ladder and sorts numerically; `name` is a string,
        # so it puts "Grade 10" before "Grade 2". Both are offered because the table
        # renders both, and they are not the same order.
        self.assertEqual(self._ids("/api/v1/classes?ordering=level"), [str(two.pk), str(ten.pk)])
        self.assertEqual(self._ids("/api/v1/classes?ordering=-level"), [str(ten.pk), str(two.pk)])
        self.assertEqual(self._ids("/api/v1/classes?ordering=name"), [str(ten.pk), str(two.pk)])
        self.assertEqual(self._ids("/api/v1/classes?ordering=-code"), [str(two.pk), str(ten.pk)])

    def test_classes_ignore_an_undeclared_ordering_field(self) -> None:
        self.allow("school.class.view")
        with tenant_context(self.tenant.id):
            ten = ClassFactory(tenant=self.tenant, name="Grade 10", level=10, is_active=False)
            two = ClassFactory(tenant=self.tenant, name="Grade 2", level=2)

        # `is_active` filters this endpoint but does not sort it; honoured, false
        # first would lead with Grade 10 instead of the default `level` order.
        self.assertEqual(
            self._ids("/api/v1/classes?ordering=is_active"), [str(two.pk), str(ten.pk)]
        )

    # ------------------------------------------------------------------ sections

    def test_sections_sort_by_the_annotated_class_and_campus_names(self) -> None:
        self.allow("school.section.view")
        with tenant_context(self.tenant.id):
            north = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            east = CampusFactory(tenant=self.tenant, name="East", code="EAST")
            ten = ClassFactory(tenant=self.tenant, name="Grade 10", level=10)
            two = ClassFactory(tenant=self.tenant, name="Grade 2", level=2)
            north_ten = SectionFactory(tenant=self.tenant, campus=north, school_class=ten, name="A")
            east_two = SectionFactory(tenant=self.tenant, campus=east, school_class=two, name="B")

        # The two annotations resolve opposite orders — "Grade 10" < "Grade 2" but
        # "East" < "North" — so an alias wired to the wrong join fails here.
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=class_name"),
            [str(north_ten.pk), str(east_two.pk)],
        )
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=-class_name"),
            [str(east_two.pk), str(north_ten.pk)],
        )
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=campus_name"),
            [str(east_two.pk), str(north_ten.pk)],
        )

    def test_sections_sort_by_capacity_with_unlimited_last(self) -> None:
        self.allow("school.section.view")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            grade = ClassFactory(tenant=self.tenant, name="Grade 1", level=1)
            small = SectionFactory(
                tenant=self.tenant, campus=campus, school_class=grade, name="A", capacity=20
            )
            large = SectionFactory(
                tenant=self.tenant, campus=campus, school_class=grade, name="B", capacity=40
            )
            unlimited = SectionFactory(
                tenant=self.tenant, campus=campus, school_class=grade, name="C", capacity=None
            )

        # `capacity` is nullable and NULL means unlimited, so the unbounded section
        # bookends the list: last ascending, first descending.
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=capacity"),
            [str(small.pk), str(large.pk), str(unlimited.pk)],
        )
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=-capacity"),
            [str(unlimited.pk), str(large.pk), str(small.pk)],
        )

    def test_sections_ignore_an_undeclared_ordering_field(self) -> None:
        self.allow("school.section.view")
        with tenant_context(self.tenant.id):
            campus = CampusFactory(tenant=self.tenant, name="North", code="NORTH")
            grade = ClassFactory(tenant=self.tenant, name="Grade 1", level=1)
            first = SectionFactory(tenant=self.tenant, campus=campus, school_class=grade, name="A")
            second = SectionFactory(
                tenant=self.tenant,
                campus=campus,
                school_class=grade,
                name="B",
                is_active=False,
            )

        # One class, so the view default reduces to `name`. `is_active` would lead
        # with B if it sorted.
        self.assertEqual(
            self._ids("/api/v1/sections?ordering=is_active"), [str(first.pk), str(second.pk)]
        )

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
