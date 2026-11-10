"""The parent portal's dashboard summary, built from each owning module's own visibility rules.

The portal owns no tables and restates no rule. Which invoices, results and threads
a guardian or student may see is each module's `services` function — the one its
own viewset calls — so a draft invoice or an unpublished result is absent here
exactly as it is from `/fee-invoices` and `/results` (ADR-0013: `services` and
`models` only, never another app's views, filters or reports).

**One grouped query per card, never one per child.** Every card is read for all
children at once and keyed by student id, so the query count does not grow with
the number of children.
"""

from __future__ import annotations

import datetime
import uuid
from decimal import Decimal
from typing import NamedTuple

from django.db.models import Count, Min, Prefetch, Sum

from apps.attendance import services as attendance_services
from apps.communication.features import FEATURE as COMMUNICATION_FEATURE
from apps.communication.threads.services.access import unread_thread_count
from apps.examinations import services as examinations_services
from apps.fees_finance import services as fees_services
from apps.student_management.models import EnrollmentStatus, Student, StudentEnrollment
from core.notifications.services import unread_notification_count
from core.rbac.permissions import (
    effective_permission_keys,
    is_restricted_principal,
    scope_queryset,
)
from core.tenancy.features import is_feature_enabled
from core.tenancy.models import Tenant

STUDENT_VIEW_KEY = "students.student.view"


class ModuleCard(NamedTuple):
    """The key a card is read under and the module flag that must be on."""

    permission: str
    feature: str


#: Each tab's module, the list/view key its owning module reads it under, and its flag.
MODULE_CARDS: dict[str, ModuleCard] = {
    "attendance": ModuleCard(attendance_services.STUDENT_ATTENDANCE_VIEW_KEY, "module.attendance"),
    "fees": ModuleCard(fees_services.INVOICE_VIEW_KEY, "module.fees_finance"),
    "examinations": ModuleCard(examinations_services.RESULT_VIEW_KEY, "module.examinations"),
    "communication": ModuleCard("communication.thread.view", COMMUNICATION_FEATURE),
    "timetable": ModuleCard("timetable.timetable.view", "module.timetable"),
}


def module_access(user, *, tenant_id: uuid.UUID) -> dict[str, bool]:
    """Per module: the caller holds its key and the module is on for the school.

    Both reads are cached (`scope_grants`, `is_feature_enabled`), never per row.
    """
    keys = effective_permission_keys(user)
    return {
        name: card.permission in keys and is_feature_enabled(card.feature, tenant_id=tenant_id)
        for name, card in MODULE_CARDS.items()
    }


def portal_children(user) -> list[Student]:
    """The students this caller sees in the portal, each with its active enrolment prefetched.

    Own students (a student's own row, a guardian's portal-enabled children) **and**
    the record scope of `students.student.view`. Scope alone is wrong: a school owner
    holds every key at scope `all`, so they would get every student in the school in
    one unpaginated response. Ownership alone would ignore the key. A school owner
    has no guardian links, so gets no children. Ordered by first name, then id.
    """
    owned = Student.filter_owned_by_user(Student.objects.alive(), user)
    enrollments = (
        StudentEnrollment.objects.alive()
        .filter(status=EnrollmentStatus.ACTIVE)
        .select_related("school_class", "section")
        .order_by("-enrollment_date")
    )
    students = scope_queryset(owned, user, permission=STUDENT_VIEW_KEY).prefetch_related(
        # No `to_attr`: `.enrollments.all()` reads this filtered cache and stays typed.
        Prefetch("enrollments", queryset=enrollments)
    )
    return list(students.order_by("first_name", "id"))


def tenant_today(tenant_id: uuid.UUID) -> datetime.date:
    """Today in the school's timezone."""
    return Tenant.objects.only("timezone").get(pk=tenant_id).local_date()


def build_dashboard(*, user, today: datetime.date | None = None) -> dict:
    """The portal's landing summary: one card set per child, plus the caller's unread counts.

    A card is `None` when its module is off for the school or the caller lacks its
    key — the same answer `modules` gives for the tab. `today` is the school's local
    date (the view passes it from the bound tenant); it defaults to looking it up.
    """
    tenant_id = user.tenant_id
    modules = module_access(user, tenant_id=tenant_id)
    today = today or tenant_today(tenant_id)
    children = portal_children(user)
    ids = [child.pk for child in children]

    attendance = _attendance_cards(user, ids, today=today) if modules["attendance"] else None
    fees = _fees_cards(user, ids) if modules["fees"] else None
    results = _latest_results(user, ids) if modules["examinations"] else None

    unread_threads = None
    if modules["communication"]:
        unread_threads = unread_thread_count(user, restricted=is_restricted_principal(user))

    return {
        "as_of": today,
        "children": [
            {
                "student": _student_summary(child),
                "attendance": None if attendance is None else attendance[child.pk],
                "fees": None if fees is None else fees[child.pk],
                "latest_result": None if results is None else results.get(child.pk),
            }
            for child in children
        ],
        "unread_notifications": unread_notification_count(user),
        "unread_threads": unread_threads,
        "modules": modules,
    }


def _student_summary(student: Student) -> dict:
    # The prefetch holds only active enrolments, newest first.
    enrollment = next(iter(student.enrollments.all()), None)
    return {
        "id": student.pk,
        "first_name": student.first_name,
        "last_name": student.last_name,
        "admission_number": student.admission_number,
        "class_name": enrollment.school_class.name if enrollment else None,
        "section_name": enrollment.section.name if enrollment else None,
    }


def _attendance_cards(user, ids: list[uuid.UUID], *, today: datetime.date) -> dict[uuid.UUID, dict]:
    """Today's status and the month's rate, over the rows attendance itself shows the caller.

    Counted by attendance's own report. Two queries.
    """
    rows = attendance_services.visible_attendance(user)
    month = attendance_services.student_month_summary(rows=rows, students=ids, month=today)
    statuses = attendance_services.student_day_status(rows=rows, students=ids, on_date=today)
    cards = {}
    for student_id in ids:
        row = month.get(student_id)
        if row is None:
            present, counted, rate = 0, 0, None
        else:
            present, counted = row["present_days"], row["counted_days"]
            # Nothing counted yet is "no rate", not 0% — a new month must not read as truancy.
            rate = row["attendance_rate"] if counted else None
        cards[student_id] = {
            "today": statuses.get(student_id),
            "month_percentage": rate,
            "month_present_days": present,
            "month_counted_days": counted,
        }
    return cards


def _fees_cards(user, ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """What each child still owes, over the invoices fees itself shows the caller. One query."""
    outstanding = fees_services.outstanding_invoices(fees_services.visible_invoices(user))
    rows = (
        outstanding.filter(student_id__in=ids)
        .order_by()
        .values("student_id")
        .annotate(total=Sum("balance_due"), count=Count("pk"), next_due=Min("due_date"))
    )
    by_student = {row["student_id"]: row for row in rows}
    cards = {}
    for student_id in ids:
        row = by_student.get(student_id)
        cards[student_id] = {
            "outstanding_total": row["total"] if row else Decimal("0.00"),
            "outstanding_count": row["count"] if row else 0,
            "next_due_date": row["next_due"] if row else None,
        }
    return cards


def _latest_results(user, ids: list[uuid.UUID]) -> dict[uuid.UUID, dict]:
    """Each child's most recently published result the caller may see. One query.

    `DISTINCT ON (student_id)` keeps the first row per child of an order newest
    first, so one query serves any number of children.
    """
    if not ids:
        return {}
    latest = (
        examinations_services.visible_results(user)
        .filter(student_id__in=ids, published_at__isnull=False)
        .select_related("exam", "grade_band")
        .order_by("student_id", "-published_at", "-id")
        .distinct("student_id")
    )
    return {
        result.student_id: {
            "exam_name": result.exam.name,
            "percentage": result.percentage,
            "grade": result.grade_band.label if result.grade_band else None,
            "published_at": result.published_at,
        }
        for result in latest
    }
