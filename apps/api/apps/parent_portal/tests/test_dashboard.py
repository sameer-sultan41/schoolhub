"""`GET /parent-portal/dashboard` — whose children, which cards, and what each card counts.

Every card is read through its owning module's own visibility function, so the
assertions here are the same rules those modules' endpoints enforce: no draft or
canceled invoice, no unpublished result, no thread about a child whose portal
access was revoked.
"""

from __future__ import annotations

import datetime
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import serializers

from apps.attendance.models import AttendanceStatus
from apps.attendance.tests.factories import StudentAttendanceFactory
from apps.communication.models import ThreadType
from apps.communication.tests.factories import MessageFactory, MessageThreadFactory
from apps.examinations.models import ResultStatus
from apps.examinations.tests.factories import ResultFactory
from apps.fees_finance.models import InvoiceStatus
from apps.fees_finance.tests.factories import FeeInvoiceFactory
from apps.parent_portal.tests.base import GUARDIAN_KEYS, TODAY, URL, ParentPortalTestCase
from apps.school_organization.tests.factories import UserFactory, authenticate, grant
from apps.student_management.models import StudentGuardian
from apps.timetable.tests.factories import PeriodFactory, disable_feature
from core.rbac.models import RecordScope
from core.rbac.registry import registry
from core.tenancy.context import tenant_context


def publish_result(case: ParentPortalTestCase, student, **fields):
    """A published, attributable result for ``student`` in a fresh exam."""
    name = fields.pop("exam_name", None)
    exam = case.exam(name=name) if name else case.exam()
    approved = timezone.now() - datetime.timedelta(days=5)
    with tenant_context(case.tenant.id):
        return ResultFactory(
            tenant=case.tenant,
            exam=exam,
            student=student,
            section=case.section,
            status=fields.pop("status", ResultStatus.PUBLISHED),
            approved_by=case.guardian_user.pk,
            approved_at=approved,
            **fields,
        )


class ChildrenTests(ParentPortalTestCase):
    def test_guardian_sees_one_card_per_linked_child(self) -> None:
        data = self.dashboard()

        self.assertEqual(self.child_ids(data), [str(self.students[0].pk), str(self.students[1].pk)])
        first = data["children"][0]
        self.assertEqual(
            first["student"],
            {
                "id": str(self.students[0].pk),
                "first_name": "Ayesha",
                "last_name": self.students[0].last_name,
                "admission_number": self.students[0].admission_number,
                "class_name": "Grade 8",
                "section_name": "A",
            },
        )
        self.assertEqual(set(first), {"student", "attendance", "fees", "latest_result"})
        self.assertIsNotNone(first["attendance"])
        self.assertIsNotNone(first["fees"])
        # No published result yet: the card is on, it just has nothing to show.
        self.assertIsNone(first["latest_result"])

    def test_child_without_portal_access_is_absent(self) -> None:
        self.link(self.guardian_user, self.students[2], has_portal_access=False)
        with tenant_context(self.tenant.id):
            FeeInvoiceFactory(
                tenant=self.tenant, student=self.students[2], academic_session=self.session
            )

        data = self.dashboard()

        self.assertNotIn(str(self.students[2].pk), self.child_ids(data))
        self.assertEqual(len(data["children"]), 2)

    def test_student_sees_only_self(self) -> None:
        student_user = UserFactory(tenant=self.tenant)
        grant(
            student_user,
            "parent-portal.dashboard.view",
            "students.student.view",
            scope=RecordScope.OWN,
            is_restricted_principal=True,
        )
        with tenant_context(self.tenant.id):
            self.students[1].user_id = student_user.pk
            self.students[1].save(update_fields=["user_id"])

        data = self.dashboard(student_user)

        self.assertEqual(self.child_ids(data), [str(self.students[1].pk)])

    def test_school_owner_summary_lists_no_children(self) -> None:
        # Every registered key at scope `all`: scope alone would list every student.
        owner = UserFactory(tenant=self.tenant)
        grant(owner, *(spec.key for spec in registry.all()), scope=RecordScope.ALL)

        data = self.dashboard(owner)

        self.assertEqual(data["children"], [])
        self.assertTrue(all(data["modules"].values()))


class CardVisibilityTests(ParentPortalTestCase):
    def test_disabled_module_card_is_null(self) -> None:
        disable_feature(self.tenant, "module.fees_finance")

        data = self.dashboard()

        self.assertFalse(data["modules"]["fees"])
        self.assertTrue(all(child["fees"] is None for child in data["children"]))
        self.assertTrue(all(child["attendance"] is not None for child in data["children"]))

    def test_missing_key_card_is_null(self) -> None:
        keys = tuple(key for key in GUARDIAN_KEYS if key != "exams.result.view")
        user = self.make_guardian(self.students[0], keys=keys)
        publish_result(self, self.students[0], published_at=timezone.now())

        data = self.dashboard(user)

        self.assertFalse(data["modules"]["examinations"])
        self.assertIsNone(data["children"][0]["latest_result"])

    def test_modules_flags_reflect_key_and_feature(self) -> None:
        disable_feature(self.tenant, "module.communication")
        keys = tuple(key for key in GUARDIAN_KEYS if key != "timetable.timetable.view")
        user = self.make_guardian(self.students[0], keys=keys)

        data = self.dashboard(user)

        self.assertEqual(
            data["modules"],
            {
                "attendance": True,
                "fees": True,
                "examinations": True,
                "communication": False,  # key held, module off
                "timetable": False,  # module on, key missing
            },
        )
        self.assertIsNone(data["unread_threads"])

    def test_staff_without_key_is_403(self) -> None:
        staff = UserFactory(tenant=self.tenant)
        grant(staff, "students.student.view", "fees.invoice.view")
        authenticate(self.client, staff)

        response = self.client.get(URL)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "permission_denied")

    def test_portal_module_off_is_403_module_disabled(self) -> None:
        disable_feature(self.tenant, "module.parent_portal")

        response = self.client.get(URL)

        self.assertEqual(response.status_code, 403)
        self.assertEqual(response.json()["error"]["code"], "module_disabled")


class LatestResultTests(ParentPortalTestCase):
    def test_latest_result_skips_unpublished(self) -> None:
        published_at = timezone.now() - datetime.timedelta(days=2)
        with tenant_context(self.tenant.id):
            band = self.scale.bands.get(label="C")
        publish_result(
            self,
            self.students[0],
            exam_name="Midterm",
            published_at=published_at,
            percentage=Decimal("65.00"),
            grade_band=band,
        )
        # Newer, but only approved. Its stray `published_at` stamp proves the status
        # rule applies, not merely the timestamp.
        publish_result(
            self,
            self.students[0],
            exam_name="Finals",
            status=ResultStatus.APPROVED,
            published_at=timezone.now(),
        )

        card = self.dashboard()["children"][0]["latest_result"]

        self.assertEqual(card["exam_name"], "Midterm")
        self.assertEqual(Decimal(card["percentage"]), Decimal("65.00"))
        self.assertEqual(card["grade"], "C")
        self.assertEqual(
            card["published_at"], serializers.DateTimeField().to_representation(published_at)
        )


class FeesCardTests(ParentPortalTestCase):
    def invoice(self, period_label: str, **fields):
        with tenant_context(self.tenant.id):
            return FeeInvoiceFactory(
                tenant=self.tenant,
                student=fields.pop("student", self.students[0]),
                academic_session=self.session,
                period_label=period_label,
                **fields,
            )

    def test_fees_card_excludes_draft_and_canceled_invoices(self) -> None:
        self.invoice("2026-09", due_date=datetime.date(2026, 9, 10))  # owes 1000
        self.invoice(  # partly paid: owes 600, due first
            "2026-08",
            status=InvoiceStatus.PARTIALLY_PAID,
            issue_date=datetime.date(2026, 8, 1),
            due_date=datetime.date(2026, 8, 10),
            paid_total=Decimal("400.00"),
        )
        self.invoice("2026-10", status=InvoiceStatus.DRAFT, due_date=datetime.date(2026, 9, 5))
        self.invoice(
            "2026-11",
            status=InvoiceStatus.CANCELED,
            canceled_reason="Billed twice.",
            due_date=datetime.date(2026, 9, 2),
        )
        self.invoice("2026-12", status=InvoiceStatus.PAID, paid_total=Decimal("1000.00"))
        # Another family's child: never counted.
        self.invoice("2026-09", student=self.students[2])

        data = self.dashboard()
        first, second = data["children"]

        self.assertEqual(Decimal(first["fees"]["outstanding_total"]), Decimal("1600.00"))
        self.assertEqual(first["fees"]["outstanding_count"], 2)
        self.assertEqual(first["fees"]["next_due_date"], "2026-08-10")
        self.assertEqual(
            second["fees"],
            {"outstanding_total": "0.00", "outstanding_count": 0, "next_due_date": None},
        )


class AttendanceCardTests(ParentPortalTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.periods = [PeriodFactory(tenant=self.tenant, sequence=n) for n in (1, 2)]

    def mark(self, on_date, value, period=None, student=None) -> None:
        with tenant_context(self.tenant.id):
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=student or self.students[0],
                section=self.section,
                academic_session=self.session,
                attendance_date=on_date,
                period=period,
                status=value,
                marked_by=self.guardian_user.pk,
            )

    def test_attendance_card_matches_attendance_summary(self) -> None:
        first_of_month = TODAY.replace(day=1)
        # Period mode: two periods of one date are one day, a half day when one is absent.
        self.mark(TODAY - datetime.timedelta(days=2), AttendanceStatus.PRESENT, self.periods[0])
        self.mark(TODAY - datetime.timedelta(days=2), AttendanceStatus.ABSENT, self.periods[1])
        # Approved leave is neither present nor counted against the child.
        self.mark(TODAY - datetime.timedelta(days=1), AttendanceStatus.ON_LEAVE)
        self.mark(first_of_month, AttendanceStatus.ABSENT)
        # Today: the earliest period late makes the day late.
        self.mark(TODAY, AttendanceStatus.LATE, self.periods[0])
        self.mark(TODAY, AttendanceStatus.PRESENT, self.periods[1])
        # Last month: outside the card.
        self.mark(first_of_month - datetime.timedelta(days=1), AttendanceStatus.ABSENT)

        card = self.dashboard()["children"][0]["attendance"]

        # Days: half day (present), on leave (excluded), absent, late (present).
        self.assertEqual(card["today"], AttendanceStatus.LATE)
        self.assertEqual(card["month_counted_days"], 3)
        self.assertEqual(card["month_present_days"], 2)
        self.assertEqual(Decimal(card["month_percentage"]), Decimal("66.7"))

        # The same numbers attendance's own §13 summary reports for the month.
        staff = UserFactory(tenant=self.tenant)
        grant(staff, "attendance.report.view", scope=RecordScope.ALL)
        authenticate(self.client, staff)
        report = self.client.get(
            "/api/v1/reports/attendance-summary",
            {
                "kind": "student-summary",
                "start_date": first_of_month.isoformat(),
                "end_date": TODAY.isoformat(),
            },
        )
        self.assertEqual(report.status_code, 200, report.json())
        (row,) = report.json()["data"]
        self.assertEqual(row["counted_days"], card["month_counted_days"])
        self.assertEqual(row["present_days"], card["month_present_days"])
        self.assertEqual(Decimal(str(row["attendance_rate"])), Decimal(card["month_percentage"]))

    def test_nothing_marked_is_no_rate_rather_than_zero(self) -> None:
        card = self.dashboard()["children"][0]["attendance"]

        self.assertEqual(
            card,
            {
                "today": None,
                "month_percentage": None,
                "month_present_days": 0,
                "month_counted_days": 0,
            },
        )


class UnreadCountTests(ParentPortalTestCase):
    def thread_about(self, student, sender):
        with tenant_context(self.tenant.id):
            thread = MessageThreadFactory(
                tenant=self.tenant,
                thread_type=ThreadType.GUARDIAN_SCHOOL,
                student=student,
                participant_user_ids=[str(self.guardian_user.pk), str(sender.pk)],
            )
            MessageFactory(thread=thread, sender_id=sender.pk)
        return thread

    def test_unread_threads_excludes_revoked_child_threads(self) -> None:
        teacher = UserFactory(tenant=self.tenant)
        self.thread_about(self.students[0], teacher)
        self.thread_about(self.students[1], teacher)
        self.assertEqual(self.dashboard()["unread_threads"], 2)

        with tenant_context(self.tenant.id):
            link = StudentGuardian.objects.get(student=self.students[1])
            link.has_portal_access = False
            link.save(update_fields=["has_portal_access"])

        data = self.dashboard()

        self.assertEqual(data["unread_threads"], 1)
        self.assertEqual(self.child_ids(data), [str(self.students[0].pk)])

    def test_unread_notifications_counts_own_unread_rows(self) -> None:
        from core.notifications.tests.test_inbox import make_notification

        make_notification(self.tenant, self.guardian_user)
        make_notification(self.tenant, self.guardian_user, read_at=timezone.now())
        make_notification(self.tenant, UserFactory(tenant=self.tenant))

        self.assertEqual(self.dashboard()["unread_notifications"], 1)


class QueryCountTests(ParentPortalTestCase):
    def populate(self, student) -> None:
        """Every card has something to read for ``student``."""
        with tenant_context(self.tenant.id):
            StudentAttendanceFactory(
                tenant=self.tenant,
                student=student,
                section=self.section,
                academic_session=self.session,
                attendance_date=TODAY,
                status=AttendanceStatus.PRESENT,
                marked_by=self.guardian_user.pk,
            )
            FeeInvoiceFactory(tenant=self.tenant, student=student, academic_session=self.session)
        publish_result(self, student, published_at=timezone.now())

    def queries_for(self, user) -> int:
        authenticate(self.client, user)
        self.client.get(URL)  # warm the per-user and per-tenant caches
        with CaptureQueriesContext(connection) as captured:
            response = self.client.get(URL)
        self.assertEqual(response.status_code, 200, response.json())
        return len(captured)

    def test_query_count_constant_for_one_and_three_children(self) -> None:
        for student in self.students:
            self.populate(student)
        one = self.make_guardian(self.students[0])
        three = self.make_guardian(*self.students)

        self.assertEqual(len(self.dashboard(three)["children"]), 3)
        self.assertEqual(self.queries_for(one), self.queries_for(three))
