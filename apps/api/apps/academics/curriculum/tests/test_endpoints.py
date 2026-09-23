"""API-level tests for `/class-subjects` — curriculum."""

from __future__ import annotations

from unittest import mock

from rest_framework import status

from apps.academics.tests.base import AcademicsAPITestCase
from apps.academics.tests.factories import ClassSubjectFactory, SubjectFactory
from apps.school_organization import services as school_services
from apps.school_organization.models import ClassSubject, SessionStatus, Subject
from core.tenancy.context import tenant_context


class CurriculumEndpointTests(AcademicsAPITestCase):
    """`/class-subjects` moved from school_organization to academics.

    The route is unchanged; the keys and the feature flag are not, which is the
    point of these tests — a caller holding only the old `school.subject.*` keys
    must now be refused.
    """

    def test_listing_requires_the_academics_key_not_the_school_one(self) -> None:
        self.allow("school.subject.view")

        self.assertEqual(
            self.client.get("/api/v1/class-subjects").status_code,
            status.HTTP_403_FORBIDDEN,
        )

        self.allow("academics.curriculum.view")
        self.assertEqual(self.client.get("/api/v1/class-subjects").status_code, status.HTTP_200_OK)

    def test_create_goes_through_the_school_organization_service(self) -> None:
        self.allow("academics.curriculum.create", "academics.curriculum.view")
        with tenant_context(self.tenant.id):
            other_subject = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(other_subject.pk),
                "weekly_periods": 4,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_201_CREATED, response.json())
        with tenant_context(self.tenant.id):
            self.assertTrue(
                ClassSubject.objects.alive()
                .filter(academic_session=self.session, subject=other_subject)
                .exists()
            )

    def test_a_duplicate_mapping_is_a_conflict(self) -> None:
        """`map_subject_to_class` owns this rule; the API must surface it as 409."""
        self.allow("academics.curriculum.create")

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(self.subject.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_409_CONFLICT)

    def test_weekly_periods_below_one_is_rejected(self) -> None:
        """400 with the field named, not the service's 422.

        `map_subject_to_class` raises `DomainRuleViolation` for this too, but the
        serializer's field validator runs first and never lets it get there — and
        that is the better answer. `weekly_periods >= 1` is a constraint on the
        value itself, needing no other state to decide, which is what separates a
        400 from a 422 in the envelope contract. The form gets a field to
        highlight rather than a bare message.
        """
        self.allow("academics.curriculum.create")
        with tenant_context(self.tenant.id):
            other_subject = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(other_subject.pk),
                "weekly_periods": 0,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(
            "weekly_periods",
            {row["field"] for row in response.json()["error"]["details"]},
        )

    def test_an_elective_mapping_needs_a_group(self) -> None:
        """400 with the field named, which the ownership move had quietly cost.

        `map_subject_to_class` enforces this too, but with a bare string — so
        once the endpoint moved here and the serializer stopped checking, the
        form got a 422 on `non_field` where it used to get a 400 on
        `elective_group`. The serializer checks again, which also covers the
        PATCH path the service never sees.
        """
        self.allow("academics.curriculum.create")
        with tenant_context(self.tenant.id):
            other_subject = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(other_subject.pk),
                "weekly_periods": 4,
                "is_elective": True,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_400_BAD_REQUEST)
        self.assertIn(
            "elective_group",
            {row["field"] for row in response.json()["error"]["details"]},
        )

    def test_an_inactive_subject_cannot_be_mapped(self) -> None:
        """422, unlike the two above: whether a subject is active is state on
        another row, so it is a domain rule rather than a field constraint."""
        self.allow("academics.curriculum.create")
        with tenant_context(self.tenant.id):
            other_subject = SubjectFactory(tenant=self.tenant, is_active=False)

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(other_subject.pk),
                "weekly_periods": 4,
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_a_closed_session_is_read_only(self) -> None:
        """§11's session lock."""
        self.allow("academics.curriculum.create")
        with tenant_context(self.tenant.id):
            self.session.status = SessionStatus.CLOSED
            self.session.save(update_fields=["status"])
            other_subject = SubjectFactory(tenant=self.tenant)

        response = self.client.post(
            "/api/v1/class-subjects",
            {
                "academic_session_id": str(self.session.pk),
                "class_id": str(self.school_class.pk),
                "subject_id": str(other_subject.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)

    def test_term_plans_must_reference_this_sessions_terms(self) -> None:
        self.allow("academics.curriculum.update")
        with tenant_context(self.tenant.id):
            stray_term = self.next_session.terms.create(
                tenant=self.tenant,
                name="Stray",
                sequence=1,
                start_date=self.next_session.start_date,
                end_date=self.next_session.end_date,
            )

        response = self.client.patch(
            f"/api/v1/class-subjects/{self.curriculum.pk}",
            {"term_plans": [{"term_id": str(stray_term.pk), "topics": ["x"]}]},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)


class CurriculumElectiveGroupTests(AcademicsAPITestCase):
    """§11's "an elective group needs at least two options", on the *edit* path.

    The rule was wired into `perform_destroy` only, so a PATCH could take the
    last row out of a group by renaming its `elective_group` and shrink the group
    with nothing noticing. The check cannot live in `CurriculumSerializer` —
    what decides it is the siblings the row leaves behind, not the payload.
    """

    def _elective(self, group: str) -> ClassSubject:
        with tenant_context(self.tenant.id):
            return ClassSubjectFactory(
                tenant=self.tenant,
                academic_session=self.session,
                school_class=self.school_class,
                subject=SubjectFactory(tenant=self.tenant),
                is_elective=True,
                elective_group=group,
            )

    def test_a_patch_may_not_take_the_last_row_out_of_a_group(self) -> None:
        self.allow("academics.curriculum.update")
        sole = self._elective("Languages")

        response = self.client.patch(
            f"/api/v1/class-subjects/{sole.pk}", {"elective_group": "Arts"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn(
            "elective_group",
            {row["field"] for row in response.json()["error"]["details"]},
        )
        with tenant_context(self.tenant.id):
            sole.refresh_from_db()
        self.assertEqual(sole.elective_group, "Languages", "the refused PATCH must not have saved")

    def test_a_patch_that_leaves_the_group_populated_is_allowed(self) -> None:
        self.allow("academics.curriculum.update")
        moving = self._elective("Languages")
        self._elective("Languages")

        response = self.client.patch(
            f"/api/v1/class-subjects/{moving.pk}", {"elective_group": "Arts"}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        with tenant_context(self.tenant.id):
            moving.refresh_from_db()
        self.assertEqual(moving.elective_group, "Arts")

    def test_a_patch_that_leaves_the_group_alone_is_untouched_by_the_rule(self) -> None:
        """A group of one is a group being built up — editing it is not removal."""
        self.allow("academics.curriculum.update")
        sole = self._elective("Languages")

        response = self.client.patch(
            f"/api/v1/class-subjects/{sole.pk}", {"notes": "Set in period 6."}, format="json"
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())


class CurriculumDeleteTests(AcademicsAPITestCase):
    """`BlockingDestroyMixin`, which the move from school_organization dropped.

    Nothing has a foreign key to `class_subjects` yet, so `_live_dependents` is
    stubbed rather than a real dependent being built — the regression is the
    missing *wiring*, and stubbing the one query it makes is what lets that be
    asserted before the first module that adds the FK depends on it. `PROTECT`
    is no backstop here either: `perform_destroy` is a soft delete, so the
    database never sees a DELETE to refuse.
    """

    def test_a_row_with_live_dependents_is_refused_with_a_422(self) -> None:
        self.allow("academics.curriculum.delete")

        with mock.patch.object(
            school_services, "_live_dependents", return_value=["timetable entries"]
        ):
            response = self.client.delete(f"/api/v1/class-subjects/{self.curriculum.pk}")

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)
        self.assertIn("timetable entries", response.json()["error"]["message"])
        with tenant_context(self.tenant.id):
            self.assertTrue(
                ClassSubject.objects.alive().filter(pk=self.curriculum.pk).exists(),
                "a refused delete must not have soft-deleted the row",
            )

    def test_a_row_nothing_points_at_still_deletes(self) -> None:
        self.allow("academics.curriculum.delete")

        response = self.client.delete(f"/api/v1/class-subjects/{self.curriculum.pk}")

        self.assertEqual(response.status_code, status.HTTP_204_NO_CONTENT)
        with tenant_context(self.tenant.id):
            self.assertFalse(ClassSubject.objects.alive().filter(pk=self.curriculum.pk).exists())


class CloneCurriculumTests(AcademicsAPITestCase):
    def test_clones_rows_into_the_target_session(self) -> None:
        self.allow("academics.curriculum.create")

        response = self.client.post(
            "/api/v1/class-subjects:clone",
            {
                "source_academic_session_id": str(self.session.pk),
                "target_academic_session_id": str(self.next_session.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["created"], 1)
        with tenant_context(self.tenant.id):
            self.assertTrue(
                ClassSubject.objects.alive()
                .filter(academic_session=self.next_session, subject=self.subject)
                .exists()
            )

    def test_re_cloning_skips_rows_that_already_exist(self) -> None:
        """Converges rather than refusing — what makes the action safe to retry."""
        self.allow("academics.curriculum.create")
        payload = {
            "source_academic_session_id": str(self.session.pk),
            "target_academic_session_id": str(self.next_session.pk),
        }
        self.client.post("/api/v1/class-subjects:clone", payload, format="json")

        second = self.client.post("/api/v1/class-subjects:clone", payload, format="json")

        self.assertEqual(second.json()["data"], {"created": 0, "skipped": 1})

    def test_cloning_a_session_onto_itself_is_rejected(self) -> None:
        self.allow("academics.curriculum.create")

        response = self.client.post(
            "/api/v1/class-subjects:clone",
            {
                "source_academic_session_id": str(self.session.pk),
                "target_academic_session_id": str(self.session.pk),
            },
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_422_UNPROCESSABLE_ENTITY)


class CurriculumOrderingTests(AcademicsAPITestCase):
    """`?ordering=` on `/class-subjects`, one case per column the grid renders.

    Ordering is an allowlist (`CurriculumViewSet.ordering_fields`), so these cover
    both halves of it: what is on it sorts, what is not is dropped rather than
    answered with an error.
    """

    def _grid(self) -> None:
        """Four rows whose subject-name and weekly-period orders differ.

        Deliberately different: a sort assertion only proves something if the
        column under test is the one that could have produced that sequence.
        """
        with tenant_context(self.tenant.id):
            # base.py already made one row; both of its sort keys are pinned here
            # so nothing below leans on a factory sequence number to decide where
            # that row lands.
            Subject.objects.filter(pk=self.subject.pk).update(name="Physics")
            ClassSubject.objects.filter(pk=self.curriculum.pk).update(weekly_periods=4)
            for subject_name, periods in (("Zoology", 5), ("Algebra", 7), ("Music", 2)):
                subject = SubjectFactory(tenant=self.tenant, name=subject_name)
                ClassSubjectFactory(
                    tenant=self.tenant,
                    academic_session=self.session,
                    school_class=self.school_class,
                    subject=subject,
                    weekly_periods=periods,
                )

    def _periods(self, query: str) -> list[int]:
        response = self.client.get(f"/api/v1/class-subjects{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [row["weekly_periods"] for row in response.json()["data"]]

    def test_orders_by_weekly_periods_ascending(self) -> None:
        self.allow("academics.curriculum.view")
        self._grid()

        self.assertEqual(self._periods("?ordering=weekly_periods"), [2, 4, 5, 7])

    def test_orders_by_weekly_periods_descending(self) -> None:
        self.allow("academics.curriculum.view")
        self._grid()

        self.assertEqual(self._periods("?ordering=-weekly_periods"), [7, 5, 4, 2])

    def test_orders_by_the_subject_it_maps(self) -> None:
        """The annotated related sort — `subject_name`, never `subject__name`."""
        self.allow("academics.curriculum.view")
        self._grid()

        # Algebra(7), Music(2), Physics(4), Zoology(5).
        self.assertEqual(self._periods("?ordering=subject_name"), [7, 2, 4, 5])
        self.assertEqual(self._periods("?ordering=-subject_name"), [5, 4, 2, 7])

    def test_an_undeclared_ordering_field_is_ignored_rather_than_an_error(self) -> None:
        """`notes` is on the serializer, so DRF would take it with no allowlist.

        Asserted against an unordered request rather than a literal sequence:
        `ClassSubject.Meta.ordering` ends in `subject_id`, and those are UUIDs, so
        the default order is stable per run but not writable down.
        """
        self.allow("academics.curriculum.view")
        self._grid()

        baseline = self.client.get("/api/v1/class-subjects")
        ignored = self.client.get("/api/v1/class-subjects?ordering=notes")

        self.assertEqual(ignored.status_code, status.HTTP_200_OK, ignored.json())
        self.assertEqual(
            [row["id"] for row in ignored.json()["data"]],
            [row["id"] for row in baseline.json()["data"]],
        )
