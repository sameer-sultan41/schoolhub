"""Endpoint-level tests for the promotion-batch resource."""

from __future__ import annotations

import datetime
import uuid

from django.utils import timezone
from rest_framework import status

from apps.academics.models import PromotionStatus, StudentPromotion
from apps.academics.tests.base import AcademicsAPITestCase
from apps.academics.tests.factories import StudentPromotionFactory
from apps.student_management.tests.factories import StudentEnrollmentFactory, StudentFactory
from core.tenancy.context import tenant_context


class PromotionBatchOrderingTests(AcademicsAPITestCase):
    """`?ordering=` on `/student-promotions`, which is an aggregate, not a table.

    Two things are being protected here. The obvious one is that the batch list
    declared no `ordering_fields` at all, so DRF accepted a sort on any serializer
    field. The subtle one is that this queryset is a `.values(...).annotate(...)`,
    where an ordering column that is not already selected joins the GROUP BY — the
    list then silently returns one row per *student*, each claiming `students: 1`,
    with a 200 and no error anywhere. Every test below therefore asserts the
    counts as well as the sequence.
    """

    def setUp(self) -> None:
        super().setUp()
        now = timezone.now()
        # Deliberately not in `started_at` order, so the default ordering below is
        # asserting something.
        self.approved = self._batch(
            PromotionStatus.APPROVED, students=3, started_at=now - datetime.timedelta(days=2)
        )
        self.pending = self._batch(
            PromotionStatus.PENDING_APPROVAL,
            students=1,
            started_at=now - datetime.timedelta(days=3),
        )
        self.draft = self._batch(
            PromotionStatus.DRAFT, students=2, started_at=now - datetime.timedelta(days=1)
        )

    def _batch(self, batch_status: str, *, students: int, started_at) -> str:
        """One batch of `students` rows, written through the factories.

        Not through `POST /student-promotions`: that service builds a batch from
        whatever the class currently enrolls, and these tests need a specific
        row count, status and age per batch.
        """
        batch_id = uuid.uuid4()
        with tenant_context(self.tenant.id):
            for _ in range(students):
                student = StudentFactory(tenant=self.tenant, campus=self.campus)
                enrollment = StudentEnrollmentFactory(
                    tenant=self.tenant,
                    student=student,
                    academic_session=self.session,
                    school_class=self.school_class,
                    section=self.section,
                )
                StudentPromotionFactory(
                    tenant=self.tenant,
                    batch_id=batch_id,
                    student=student,
                    from_enrollment=enrollment,
                    from_academic_session=self.session,
                    to_academic_session=self.next_session,
                    from_class=self.school_class,
                    to_class=self.next_class,
                    status=batch_status,
                )
            # `created_at` is auto_now_add, so it can only be moved after the fact;
            # `started_at` is its Min over the batch.
            StudentPromotion.objects.filter(batch_id=batch_id).update(created_at=started_at)
        return str(batch_id)

    def _rows(self, query: str = "") -> list[tuple[str, int]]:
        """(batch_id, students) per row — the sequence and the grouping together."""
        response = self.client.get(f"/api/v1/student-promotions{query}")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return [(row["batch_id"], row["students"]) for row in response.json()["data"]]

    def test_the_default_order_is_newest_batch_first(self) -> None:
        """`get_queryset`'s own `-started_at`, untouched when no `?ordering=` arrives."""
        self.allow("academics.promotion.view")

        self.assertEqual(
            self._rows(),
            [(self.draft, 2), (self.approved, 3), (self.pending, 1)],
        )

    def test_orders_by_status_ascending(self) -> None:
        self.allow("academics.promotion.view")

        # approved, draft, pending_approval — and still one row per batch.
        self.assertEqual(
            self._rows("?ordering=status"),
            [(self.approved, 3), (self.draft, 2), (self.pending, 1)],
        )

    def test_orders_by_status_descending(self) -> None:
        self.allow("academics.promotion.view")

        self.assertEqual(
            self._rows("?ordering=-status"),
            [(self.pending, 1), (self.draft, 2), (self.approved, 3)],
        )

    def test_orders_by_the_student_count_annotation(self) -> None:
        self.allow("academics.promotion.view")

        self.assertEqual(
            self._rows("?ordering=students"),
            [(self.pending, 1), (self.draft, 2), (self.approved, 3)],
        )
        self.assertEqual(
            self._rows("?ordering=-students"),
            [(self.approved, 3), (self.draft, 2), (self.pending, 1)],
        )

    def test_orders_by_the_started_at_annotation(self) -> None:
        self.allow("academics.promotion.view")

        self.assertEqual(
            self._rows("?ordering=started_at"),
            [(self.pending, 1), (self.approved, 3), (self.draft, 2)],
        )

    def test_ordering_does_not_regroup_the_aggregate(self) -> None:
        """The regression this endpoint's ordering allowlist exists for.

        A sort column that is not in the `values()` set is added to the GROUP BY,
        and on Postgres a primary key there collapses the grouping to one row per
        promotion row. The symptom is not an error: it is three batches becoming
        six rows, each reporting a single student. Asserting the counts is what
        makes any of these tests notice.
        """
        self.allow("academics.promotion.view")

        rows = self._rows("?ordering=status")

        self.assertEqual(len(rows), 3)
        self.assertEqual(sorted(count for _, count in rows), [1, 2, 3])

    def test_an_undeclared_ordering_field_is_ignored_rather_than_an_error(self) -> None:
        """`created_at` is exactly the field that would un-group this list.

        It is on the model and on every other list in this module, which is what
        makes it worth pinning: dropped here, the default `-started_at` stands and
        the batches stay batches.
        """
        self.allow("academics.promotion.view")

        self.assertEqual(
            self._rows("?ordering=created_at"),
            [(self.draft, 2), (self.approved, 3), (self.pending, 1)],
        )

    def test_a_batch_detail_ignores_an_ordering_only_the_list_can_serve(self) -> None:
        """`retrieve` runs the same backend over the un-aggregated decision rows.

        `students` is on the allowlist because the *list* is an aggregate. The
        detail route's queryset has no such column, so ordering by it there is a
        FieldError — a 500 off a query parameter rather than a batch.
        """
        self.allow("academics.promotion.view")

        response = self.client.get(f"/api/v1/student-promotions/{self.approved}?ordering=students")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"]["students"], 3)
