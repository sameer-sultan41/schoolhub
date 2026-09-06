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
from core.jobs.models import BackgroundJob
from core.jobs.services import mark_failed, mark_running, mark_succeeded, update_progress
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


@shared_task(base=TenantAwareTask, bind=True)
def export_attendance_report_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """§13's export lane — the same rows the synchronous endpoint returns, as CSV.

    The rows are recomputed here rather than carried in the job payload: a
    payload big enough to hold a term's register is a payload big enough to be
    the reason the export exists. `core.jobs`' own prune sweep already notes that
    these rows carry base64 import payloads and are the heavier retention sweep.

    **The scope is recomputed too, from the requesting user.** A report is read as
    authoritative, so an export must not widen what its requester could see
    inline — which it would if the job re-queried the table without the record
    scope the endpoint applied.
    """
    from apps.attendance import exports, uploads
    from core.files.services import create_ready_file
    from core.rbac.models import User
    from core.tenancy.context import tenant_atomic

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)

    try:
        with tenant_atomic(uuid.UUID(tenant_id)):
            payload = job.payload
            requester = User.objects.get(pk=payload["requested_by"])
            # No `limit`: the job is the unbounded path, which is the whole
            # reason the endpoint hands it anything over the inline ceiling.
            rows = build_report_rows(
                kind=payload["kind"],
                user=requester,
                start_date=datetime.date.fromisoformat(payload["start_date"]),
                end_date=datetime.date.fromisoformat(payload["end_date"]),
                section_id=payload.get("section_id"),
            )

            fmt = payload.get("format", "csv")
            title = f"{payload['kind'].replace('-', ' ').capitalize()}"
            data, mime_type, extension = exports.render(rows, fmt=fmt, title=title)

            file = create_ready_file(
                tenant_id=uuid.UUID(tenant_id),
                purpose=uploads.REPORT_EXPORT.key,
                original_name=f"attendance-{payload['kind']}.{extension}",
                mime_type=mime_type,
                data=data,
                actor_id=uuid.UUID(actor_id),
            )
        mark_succeeded(
            job=job,
            result={"result_file_id": str(file.pk), "rows": len(rows), "format": fmt},
        )
    except Exception as exc:
        # Same shape as student-management's export task: the job row is the only
        # place a caller polling `GET /jobs/{id}` can learn this failed, so the
        # failure has to be recorded rather than propagated into a retry.
        mark_failed(job=job, error=str(exc))


def build_report_rows(
    *,
    kind: str,
    user,
    start_date: datetime.date,
    end_date: datetime.date,
    section_id: str | None = None,
    limit: int | None = None,
) -> list[dict]:
    """Build one §13 report's rows under `user`'s record scope.

    Shared by the endpoint and the export task so the two can never disagree —
    which matters more here than usual, because a principal reads the inline
    report and the exported CSV as the same document.

    `limit` caps how many rows are *materialised*, so the endpoint can decide
    "inline or job?" without paying for the answer: it asks for one more row than
    the synchronous ceiling, and getting that many back is enough to know. The
    threshold used to be checked *after* the whole term-scale query had been
    built — precisely the cost the 202-and-a-job pattern exists to avoid — and
    the result was then discarded and recomputed by the job.
    """
    from apps.attendance import reports
    from apps.attendance.models import LeaveRequest, RequesterType, StaffAttendance
    from core.rbac.permissions import scope_queryset

    if kind not in services.REPORT_KINDS:
        raise ValueError(f"Unknown report kind {kind!r}")

    if kind == "staff-punctuality":
        scoped = scope_queryset(
            StaffAttendance.objects.alive(), user, campus_field="staff__campus_id"
        )
        return reports.staff_punctuality(
            scoped, start_date=start_date, end_date=end_date, limit=limit
        )

    if kind == "leave":
        scoped = scope_queryset(
            LeaveRequest.objects.alive().filter(requester_type=RequesterType.STUDENT),
            user,
            campus_field="student__campus_id",
        )
        return reports.leave_report(scoped, start_date=start_date, end_date=end_date, limit=limit)

    scoped = scope_queryset(
        StudentAttendance.objects.alive(), user, campus_field="section__campus_id"
    )
    if section_id:
        scoped = scoped.filter(section_id=section_id)

    if kind == "daily-register":
        return reports.daily_register(scoped, on_date=start_date, limit=limit)
    if kind == "defaulters":
        return reports.defaulters(scoped, start_date=start_date, end_date=end_date, limit=limit)
    if kind == "student-late-arrivals":
        return reports.student_late_arrivals(
            scoped, start_date=start_date, end_date=end_date, limit=limit
        )
    return reports.student_summary(scoped, start_date=start_date, end_date=end_date, limit=limit)


@shared_task(base=TenantAwareTask, bind=True)
def import_attendance_task(self, *, tenant_id: str, job_id: str, actor_id: str) -> None:
    """§9's historical-register import, row by row.

    Row-by-row rather than bulk, and that is the trade §9's own journey asks for:
    "reviews the row-level error report … re-imports failed rows only" needs a
    per-row verdict, which a `bulk_create` cannot give. The importer is a
    once-per-tenant onboarding job, so the row count buys the error report.

    Progress is reported as it goes, because a year of registers is long enough
    that a caller polling `GET /jobs/{id}` needs to see it moving.
    """
    import base64

    from apps.attendance import services
    from apps.school_organization.models import AcademicSession
    from core.tenancy.context import tenant_atomic

    with tenant_atomic(uuid.UUID(tenant_id)):
        job = BackgroundJob.objects.get(pk=job_id)
    mark_running(job=job)

    try:
        payload = job.payload
        data = base64.b64decode(payload["content_base64"])
        rows = services.parse_attendance_import(filename=payload["filename"], data=data)

        with tenant_atomic(uuid.UUID(tenant_id)):
            session = AcademicSession.objects.alive().get(pk=payload["academic_session_id"])

        errors: list[dict[str, str]] = []
        succeeded = 0
        total = len(rows) or 1
        for index, row in enumerate(rows, start=1):
            with tenant_atomic(uuid.UUID(tenant_id)):
                # +1 for the header line, so the row numbers in the error report
                # match what a spreadsheet editor shows.
                error = services.import_attendance_row(
                    row=row,
                    row_number=index + 1,
                    session=session,
                    tenant_id=uuid.UUID(tenant_id),
                    actor_id=uuid.UUID(actor_id),
                )
            if error:
                errors.append(error)
            else:
                succeeded += 1
            if index % 100 == 0:
                update_progress(job=job, progress=int(index / total * 100))

        mark_succeeded(
            job=job,
            result={"rows": len(rows), "succeeded": succeeded, "errors": errors},
        )
    except Exception as exc:
        # The job row is the only place a caller polling GET /jobs/{id} can learn
        # this failed, so the failure is recorded rather than raised into a retry.
        mark_failed(job=job, error=str(exc))
