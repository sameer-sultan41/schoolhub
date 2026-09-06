"""Background work for the attendance module.

Two jobs, and they are different shapes on purpose:

- `send_attendance_alerts` is per-register, enqueued by the marking service on
  commit. Asynchronous because §7.1 fans out to every guardian of every absent
  student in a class, and a teacher submitting a register must not wait on it —
  api-architecture.md §2.7's rule that anything with an outbound effect is
  asynchronous.
- `lock_expired_attendance` is a nightly sweep, tenant by tenant.
"""

from __future__ import annotations

import datetime
import logging
import uuid

from celery import shared_task
from django.utils import timezone

from apps.attendance import notifications, services
from apps.attendance.models import AttendanceStatus, StudentAttendance
from core.tenancy.maintenance import for_each_tenant
from core.tenancy.tasks import TenantAwareTask

logger = logging.getLogger(__name__)


@shared_task(base=TenantAwareTask)
def send_attendance_alerts(*, tenant_id: str, attendance_ids: list[str]) -> dict[str, int]:
    """§12's absence and late alerts, to the guardians of the students named.

    **One `notify()` call per trigger, with the whole recipient list** — not one
    per student. `core.notifications.services.notify` persists the fan-out in two
    bulk writes for the entire list, and its own docstring gives the reason: an
    absence alert to a class of forty guardians was eighty round trips before it
    did.

    Recipients are the students' guardians with a live, portal-enabled link — the
    same gate `Student.filter_owned_by_user` uses for a guardian's read access.
    A guardian whose access has been revoked (`access_revoked_reason` on the
    link) must not keep receiving their child's attendance.
    """
    from apps.student_management.models import StudentGuardian
    from core.notifications.services import Recipient, notify
    from core.tenancy.context import tenant_atomic
    from core.tenancy.models import Tenant

    sent = 0
    with tenant_atomic(uuid.UUID(tenant_id)):
        rows = list(
            StudentAttendance.objects.alive()
            .filter(pk__in=attendance_ids)
            .select_related("student")
        )
        if not rows:
            return {"notified": 0}

        school_name = Tenant.objects.get(pk=tenant_id).name
        guardians_by_student: dict[uuid.UUID, list[uuid.UUID]] = {}
        links = (
            StudentGuardian.objects.alive()
            .filter(
                student_id__in=[row.student_id for row in rows],
                has_portal_access=True,
                guardian__deleted_at__isnull=True,
                guardian__user_id__isnull=False,
            )
            .select_related("guardian")
        )
        for link in links:
            guardians_by_student.setdefault(link.student_id, []).append(link.guardian.user_id)

        for event, status_value in (
            (notifications.ABSENCE_ALERT, AttendanceStatus.ABSENT),
            (notifications.LATE_ALERT, AttendanceStatus.LATE),
        ):
            for row in (r for r in rows if r.status == status_value):
                recipients = [
                    Recipient(user_id=user_id)
                    for user_id in guardians_by_student.get(row.student_id, [])
                ]
                if not recipients:
                    # Not an error: a student with no portal-enabled guardian is
                    # an ordinary state, and §12 has no fallback recipient.
                    continue
                try:
                    notify(
                        event,
                        tenant_id=uuid.UUID(tenant_id),
                        recipients=recipients,
                        context={
                            "student.first_name": row.student.first_name,
                            "date": row.attendance_date.isoformat(),
                            "school.name": school_name,
                        },
                        source_type="student_attendance",
                        source_id=row.pk,
                    )
                    sent += len(recipients)
                except Exception:
                    # One student's alert failing must not cost the rest of the
                    # class theirs — the register is already committed either way.
                    logger.exception("%s failed for attendance row %s", event, row.pk)

    return {"notified": sent}


def lock_tenant_attendance(tenant_id: uuid.UUID) -> int:
    """Persist `is_locked` for every row now past this tenant's window (§5.5).

    The column is the *persisted* view of what `services.is_locked` computes from
    the date, and exists so a client can render the state without recomputing it
    per row. The service never trusts the column alone — it checks both — so a
    skipped sweep degrades a rendering hint, never the rule itself.
    """
    cutoff = timezone.localdate() - datetime.timedelta(days=services.lock_window_days())
    return (
        StudentAttendance.objects.alive()
        .filter(attendance_date__lt=cutoff, is_locked=False)
        .update(is_locked=True, updated_at=timezone.now())
    )


@shared_task
def lock_expired_attendance() -> dict[str, int]:
    """Nightly, tenant by tenant.

    Tenant by tenant through `for_each_tenant` rather than one cross-tenant
    UPDATE: under RLS an unbound write does not raise, it silently matches zero
    rows, so the sweep shape is what makes this do anything at all.
    """
    return for_each_tenant(lock_tenant_attendance, job="attendance-lock")


@shared_task(base=TenantAwareTask)
def propose_cover_for_absence(
    *, tenant_id: str, staff_id: str, on_date: str, actor_id: str
) -> dict[str, int]:
    """§18's outbound edge: an absent teacher's classes need cover.

    Asynchronous because it walks a whole day's grid and asks timetable's
    conflict rules about each candidate, which is not work an HR clerk recording
    an absence should wait on — and because a proposal failing must not undo the
    attendance record, which is the fact of the matter either way.

    Swallowed and logged rather than retried: `propose_substitutions_for_absence`
    is already idempotent per (slot, date) — the unique constraint says one
    substitution each — so a re-run after a partial failure proposes only what is
    still missing, and a human is going to approve the queue regardless.
    """
    import datetime as _datetime

    from apps.staff_management.models import Staff
    from apps.timetable.services import propose_substitutions_for_absence
    from core.tenancy.context import tenant_atomic

    try:
        with tenant_atomic(uuid.UUID(tenant_id)):
            staff = Staff.objects.alive().filter(pk=staff_id).first()
            if staff is None:
                return {"proposed": 0}
            proposed = propose_substitutions_for_absence(
                staff=staff,
                on_date=_datetime.date.fromisoformat(on_date),
                actor_id=uuid.UUID(actor_id),
            )
        return {"proposed": len(proposed)}
    except Exception:
        logger.exception("cover proposal failed for staff %s on %s", staff_id, on_date)
        return {"proposed": 0}
