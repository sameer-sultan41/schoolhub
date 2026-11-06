"""The results wire contract: names on the row, typed action bodies, query counts,
and the record scope on every action that addresses an exam or a result (L46)."""

from __future__ import annotations

from django.db import connection
from django.test.utils import CaptureQueriesContext
from rest_framework import status
from rest_framework.test import APIClient

from apps.examinations import services
from apps.examinations.models import Result
from apps.examinations.serializers import (
    ResultsApprovedSerializer,
    ResultsPublishedSerializer,
    ResultsSentBackSerializer,
)
from apps.examinations.tests.factories import UserFactory, authenticate, grant
from apps.examinations.tests.test_processing import ProcessingTestCase
from core.rbac.models import RecordScope
from core.tenancy.context import tenant_context

RESULTS = "/api/v1/results"
WITHHOLD = {"reason": "Fees"}
RESULT_KEYS = (
    "exams.result.view",
    "exams.result.create",
    "exams.result.approve",
    "exams.result.publish",
)


class ProcessedResultsTestCase(ProcessingTestCase):
    def setUp(self) -> None:
        super().setUp()
        self.mark_all("60.00", "70.00", "80.00")
        with tenant_context(self.tenant.id):
            self.processor = UserFactory(tenant=self.tenant, first_name="Pat", last_name="Moore")
            self.approver = UserFactory(tenant=self.tenant, first_name="Ann", last_name="Lee")
            services.process_exam_results(exam=self.exam, actor_id=self.processor.pk)

    def approve(self) -> None:
        with tenant_context(self.tenant.id):
            services.approve_exam_results(exam=self.exam, approver_id=self.approver.pk)

    def row_for(self, student) -> Result:
        with tenant_context(self.tenant.id):
            return Result.objects.alive().get(exam=self.exam, student=student)


class ResultRowTests(ProcessedResultsTestCase):
    def test_a_listed_row_carries_its_names_and_ids(self) -> None:
        self.approve()

        response = self.client.get(RESULTS, {"student_id": str(self.students[0].pk)})

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        row = response.json()["data"][0]
        self.assertEqual(row["student_name"], self.students[0].full_name)
        self.assertEqual(row["admission_number"], self.students[0].admission_number)
        self.assertEqual(row["section_id"], str(self.section.pk))
        self.assertEqual(row["section_name"], self.section.name)
        self.assertEqual(row["processed_by"], str(self.processor.pk))
        self.assertEqual(row["processed_by_name"], "Pat Moore")
        self.assertEqual(row["approved_by"], str(self.approver.pk))
        self.assertEqual(row["approved_by_name"], "Ann Lee")

    def test_a_single_result_carries_the_names_too(self) -> None:
        """L24: the names come from the mixin, so a single-object read needs its own test."""
        row = self.row_for(self.students[0])

        response = self.client.get(f"{RESULTS}/{row.pk}")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        self.assertEqual(data["processed_by_name"], "Pat Moore")
        self.assertIsNone(data["approved_by"])
        self.assertIsNone(data["approved_by_name"])

    def test_withhold_answers_the_row_with_its_names(self) -> None:
        """L24 again: `:withhold` serializes one re-read row outside the list."""
        row = self.row_for(self.students[0])

        response = self.client.post(f"{RESULTS}/{row.pk}:withhold", WITHHOLD, format="json")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        self.assertEqual(data["outcome"], "withheld")
        self.assertEqual(data["processed_by_name"], "Pat Moore")
        self.assertEqual(data["student_name"], self.students[0].full_name)

    def test_withhold_re_reads_the_row_with_its_joins_and_locks_only_the_result(self) -> None:
        """The answer's student, section and grade come from the locked re-read, not
        three lazy loads, and the lock does not reach the joined rows."""
        row = self.row_for(self.students[0])

        with CaptureQueriesContext(connection) as captured:
            self.client.post(f"{RESULTS}/{row.pk}:withhold", WITHHOLD, format="json")

        locked = [q["sql"] for q in captured.captured_queries if "FOR UPDATE" in q["sql"]]
        self.assertEqual(len(locked), 1, locked)
        self.assertIn('FOR UPDATE OF "results"', locked[0])
        self.assertIn('"students"', locked[0])
        self.assertIn('"sections"', locked[0])
        statements = [q["sql"] for q in captured.captured_queries]
        after = statements[statements.index(locked[0]) + 1 :]
        self.assertFalse(
            any(sql.startswith("SELECT") and 'FROM "students"' in sql for sql in after),
            "the student was loaded again after the locked read",
        )

    def test_the_list_is_a_flat_number_of_queries(self) -> None:
        """One user-name query per page, and joins for the student and section."""
        self.approve()
        self.client.get(RESULTS)  # warm the permission and scope caches

        with CaptureQueriesContext(connection) as one:
            single = self.client.get(RESULTS, {"student_id": str(self.students[0].pk)})
        with CaptureQueriesContext(connection) as many:
            every = self.client.get(RESULTS)

        self.assertEqual(len(single.json()["data"]), 1)
        self.assertEqual(len(every.json()["data"]), 3)
        self.assertEqual(len(many.captured_queries), len(one.captured_queries))

    def test_the_single_read_is_a_flat_number_of_queries(self) -> None:
        self.approve()
        first, second = self.row_for(self.students[0]), self.row_for(self.students[1])
        self.client.get(f"{RESULTS}/{first.pk}")

        with CaptureQueriesContext(connection) as warm:
            self.client.get(f"{RESULTS}/{first.pk}")
        with CaptureQueriesContext(connection) as other:
            self.client.get(f"{RESULTS}/{second.pk}")

        self.assertEqual(len(other.captured_queries), len(warm.captured_queries))


class TypedActionBodyTests(ProcessedResultsTestCase):
    """Each action's `data` is its typed serializer's shape, equal to what the service returned."""

    def as_approver(self) -> APIClient:
        grant(self.approver, *RESULT_KEYS, scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, self.approver)
        return client

    def test_approve_answers_its_count(self) -> None:
        response = self.as_approver().post(f"/api/v1/exams/{self.exam.pk}:approve-results")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], {"approved": 3})
        self.assertEqual(set(ResultsApprovedSerializer().fields), {"approved"})

    def test_send_back_answers_its_count_and_reason(self) -> None:
        response = self.as_approver().post(
            f"/api/v1/exams/{self.exam.pk}:send-results-back",
            {"reason": "Re-key B"},
            format="json",
        )

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        self.assertEqual(response.json()["data"], {"reopened": 3, "reason": "Re-key B"})
        self.assertEqual(set(ResultsSentBackSerializer().fields), {"reopened", "reason"})

    def test_publish_answers_its_counts_and_the_ids_it_moved(self) -> None:
        self.approve()
        expected = {str(self.row_for(student).pk) for student in self.students}

        response = self.as_approver().post(f"/api/v1/exams/{self.exam.pk}:publish-results")

        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        data = response.json()["data"]
        self.assertEqual(set(data), set(ResultsPublishedSerializer().fields))
        self.assertEqual((data["published"], data["withheld"]), (3, 0))
        self.assertEqual(set(data["published_ids"]), expected)


class ResultActionScopeTests(ProcessedResultsTestCase):
    """L46: each action resolves its exam or result through the record scope.

    The outsider holds every results key `assigned`-scoped but teaches nothing, so
    a 404 can only come from the scope. The class teacher (a homeroom in the exam's
    session) gets past the lookup to the action's own rule.
    """

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            outsider = UserFactory(tenant=self.tenant)
        grant(outsider, *RESULT_KEYS, scope=RecordScope.ASSIGNED)
        self.outsider = APIClient()
        authenticate(self.outsider, outsider)
        grant(self.teacher_user, *RESULT_KEYS, scope=RecordScope.ASSIGNED)
        self.class_teacher = APIClient()
        authenticate(self.class_teacher, self.teacher_user)

    def exam_actions(self) -> list[tuple[str, dict]]:
        base = f"/api/v1/exams/{self.exam.pk}"
        return [
            (f"{base}:process-results", {}),
            (f"{base}:approve-results", {}),
            (f"{base}:send-results-back", {"reason": "Re-key"}),
            (f"{base}:publish-results", {}),
        ]

    def test_an_exam_outside_the_caller_s_scope_is_a_404_on_every_action(self) -> None:
        for url, body in self.exam_actions():
            with self.subTest(url=url):
                response = self.outsider.post(url, body, format="json")
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_an_all_action_role_does_not_reach_an_exam_the_view_role_hides(self) -> None:
        """L36: the read key's scope, then the action's (ADR-0031 decision 3).

        `exams.result.view` on an `assigned` role that teaches nothing, the action keys
        at `all`: the wide action role must not lend the exam the view role hides.
        """
        with tenant_context(self.tenant.id):
            mixed = UserFactory(tenant=self.tenant)
        grant(mixed, "exams.result.view", scope=RecordScope.ASSIGNED)
        grant(mixed, "exams.result.approve", "exams.result.publish", scope=RecordScope.ALL)
        client = APIClient()
        authenticate(client, mixed)

        for url, body in self.exam_actions()[1:]:
            with self.subTest(url=url):
                response = client.post(url, body, format="json")
                self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_withholding_a_result_outside_the_caller_s_scope_is_a_404(self) -> None:
        row = self.row_for(self.students[0])

        response = self.outsider.post(f"{RESULTS}/{row.pk}:withhold", WITHHOLD, format="json")

        self.assertEqual(response.status_code, status.HTTP_404_NOT_FOUND)

    def test_the_class_teacher_reaches_each_action(self) -> None:
        # Pending approval: process and publish refuse on state (409), approve
        # and send-back act. Anything but a 404 shows the lookup let them in.
        for url, body in self.exam_actions():
            with self.subTest(url=url):
                response = self.class_teacher.post(url, body, format="json")
                self.assertNotEqual(response.status_code, status.HTTP_404_NOT_FOUND)

        row = self.row_for(self.students[1])
        response = self.class_teacher.post(f"{RESULTS}/{row.pk}:withhold", WITHHOLD, format="json")
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
