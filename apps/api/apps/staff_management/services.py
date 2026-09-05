"""Business rules for the staff-management module.

Views stay thin: everything here is a rule from
docs/03-modules/staff-management.md §6 (sub-features) and §11 (validations).
Keeping it out of serializers means the same rules apply to the API, the bulk
importer, and any Celery job — mirrors student_management/services.py's
layering exactly.
"""

from __future__ import annotations

import logging
import re
import uuid
from collections.abc import Callable
from datetime import date

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.staff_management import notifications, uploads
from apps.staff_management.models import (
    DEFAULT_DOCUMENT_TYPES,
    Designation,
    EmploymentStatus,
    Gender,
    Staff,
    StaffDocument,
    StaffQualification,
    VerificationStatus,
)
from core.api.exceptions import Conflict, DomainRuleViolation
from core.tenancy.context import tenant_atomic
from core.tenancy.sequences import allocate_number

logger = logging.getLogger(__name__)

# Pattern tokens the employee-number template may use — same allowlist shape as
# student_management's admission-number pattern.
_PATTERN_TOKEN = re.compile(r"\{(campus|year)\}|\{seq(?::0(\d+)d)?\}")
_ANY_BRACE_TOKEN = re.compile(r"\{[^}]*\}")

_DEFAULT_PATTERN = "EMP-{year}-{seq:04d}"


def resolve_tenant_user_id(*, user_id: uuid.UUID | None, tenant_id: uuid.UUID) -> uuid.UUID | None:
    """Tenant-checked resolution of a portal-account link.

    ``Staff.user_id`` is a plain UUID column rather than a ForeignKey — see the
    model docstring — precisely so this check exists explicitly instead of
    being implied by a queryset that would happily resolve another tenant's
    user.
    """
    if user_id is None:
        return None

    from core.rbac.models import User

    exists = User.objects.filter(pk=user_id, tenant_id=tenant_id).exists()
    if not exists:
        raise DomainRuleViolation({"user_id": "No user with this id exists for your school."})
    return user_id


def resolve_tenant_staff_id(
    *, staff_id: uuid.UUID | None, tenant_id: uuid.UUID
) -> uuid.UUID | None:
    """Tenant-checked resolution of a ``*_staff_id`` reference from another module.

    Used by ``school_organization.serializers`` to validate ``head_staff_id`` /
    ``class_teacher_staff_id`` / ``house_master_staff_id`` — those columns are
    plain UUIDs for the same cross-tenant-leak reason ``Staff.user_id`` is (see
    the model docstring), and previously had no ownership check at all.
    Imported lazily by the caller to avoid a hard import-time dependency in the
    other direction from the one docs/03-modules declares (staff-management
    depends on school-organization, not the reverse).
    """
    if staff_id is None:
        return None
    exists = (
        Staff.objects.alive()
        .filter(pk=staff_id, tenant_id=tenant_id, employment_status=EmploymentStatus.ACTIVE)
        .exists()
    )
    if not exists:
        raise DomainRuleViolation(
            {"non_field": "No active staff member with this id exists for your school."}
        )
    return staff_id


def assert_pattern_tokens_valid(pattern: str) -> None:
    """Reject a pattern containing a `{...}` block that isn't a known token.

    Mirrors student_management.services.assert_pattern_tokens_valid exactly —
    same allowlist-substitution reasoning (never ``str.format(**ctx)``, an
    injection surface for a tenant-controlled string).
    """
    for token in _ANY_BRACE_TOKEN.findall(pattern):
        if not _PATTERN_TOKEN.fullmatch(token):
            raise DomainRuleViolation(
                {
                    "employee_number_pattern": (
                        f"'{token}' is not a recognized token. Use {{campus}}, {{year}}, "
                        "{seq}, or {seq:0Nd}."
                    )
                }
            )


def _substitute_tokens(
    pattern: str, *, campus: str, year: str, seq: Callable[[str | None], str]
) -> str:
    def _sub(match: re.Match) -> str:
        name, width = match.group(1), match.group(2)
        if name == "campus":
            return campus
        if name == "year":
            return year
        return seq(width)

    return _PATTERN_TOKEN.sub(_sub, pattern)


def _render_pattern(pattern: str, *, campus_code: str, year: str, sequence: int) -> str:
    return _substitute_tokens(
        pattern,
        campus=campus_code,
        year=year,
        seq=lambda width: str(sequence).zfill(int(width)) if width else str(sequence),
    )


def employee_number_series(*, pattern: str, campus_code: str, joining_date: date) -> str:
    """The counter's series key — see admission_number_series's identical

    reasoning: two employee numbers sharing everything except the sequence
    must share one counter.
    """
    return _substitute_tokens(
        pattern, campus=campus_code, year=str(joining_date.year), seq=lambda width: ""
    )


def render_employee_number(
    *, pattern: str, campus_code: str, joining_date: date, sequence: int
) -> str:
    return _render_pattern(
        pattern, campus_code=campus_code, year=str(joining_date.year), sequence=sequence
    )


def _tenant_settings(tenant_id: uuid.UUID) -> dict:
    from core.tenancy.models import TenantSettings

    row = TenantSettings.all_tenants.filter(tenant_id=tenant_id).first()
    return (row.hr or {}) if row else {}


@transaction.atomic
def allocate_employee_number(*, campus, joining_date: date, tenant_id: uuid.UUID) -> str:
    """Generate and reserve the next employee number for ``campus``/``joining_date``.

    Must run inside the same transaction as the Staff insert — allocate_number
    asserts this — so a create that fails afterward does not burn the number.
    """
    tenant_settings = _tenant_settings(tenant_id)
    pattern = (tenant_settings.get("employee_number_pattern") or _DEFAULT_PATTERN).strip()
    if not pattern:
        pattern = _DEFAULT_PATTERN
    assert_pattern_tokens_valid(pattern)

    series = employee_number_series(
        pattern=pattern, campus_code=campus.code, joining_date=joining_date
    )
    sequence = allocate_number(scope="employee_number", series=series, tenant_id=tenant_id)
    return render_employee_number(
        pattern=pattern, campus_code=campus.code, joining_date=joining_date, sequence=sequence
    )


def assert_employee_number_immutable(*, instance: Staff, new_value: str | None) -> None:
    if new_value is not None and new_value != instance.employee_number:
        raise DomainRuleViolation(
            {"employee_number": "employee_number is immutable after creation."}
        )


def assert_national_id_available(
    *, tenant_id: uuid.UUID, national_id: str, instance: Staff | None
) -> None:
    qs = Staff.objects.alive().filter(national_id=national_id)
    if instance is not None:
        qs = qs.exclude(pk=instance.pk)
    if qs.exists():
        raise DomainRuleViolation(
            {"national_id": "A staff member with this national ID already exists."}
        )


def assert_department_active(*, department, tenant_id: uuid.UUID) -> None:
    if department.tenant_id != tenant_id or not department.is_active:
        raise DomainRuleViolation({"department_id": "This department is not available."})


def assert_designation_active(*, designation: Designation, tenant_id: uuid.UUID) -> None:
    if designation.tenant_id != tenant_id or not designation.is_active:
        raise DomainRuleViolation({"designation_id": "This designation is not available."})


def assert_designation_deactivatable(*, designation: Designation) -> None:
    """Blocked deletion/deactivation while any staff record is assigned (§6)."""
    if Staff.objects.alive().filter(designation=designation).exists():
        raise DomainRuleViolation(
            {"is_active": "This designation is still assigned to staff and cannot be deactivated."}
        )


def assert_reports_to_acyclic(*, staff: Staff | None, reports_to: Staff) -> None:
    """Walk the ``reports_to`` chain and reject a self- or circular reference.

    No portable database constraint expresses "no cycles in this adjacency
    column" — this is service-enforced, per the module doc §11.
    """
    if staff is not None and reports_to.pk == staff.pk:
        raise DomainRuleViolation(
            {"reports_to_staff_id": "A staff member cannot report to themself."}
        )
    if staff is None:
        return
    seen = {staff.pk}
    current: Staff | None = reports_to
    while current is not None:
        if current.pk in seen:
            raise DomainRuleViolation(
                {"reports_to_staff_id": "This reporting line would create a cycle."}
            )
        seen.add(current.pk)
        current = current.reports_to


def assert_year_not_future(year_awarded: int) -> None:
    if year_awarded > timezone.now().year:
        raise DomainRuleViolation({"year_awarded": "year_awarded cannot be in the future."})


def _document_type_allowed(*, document_type: str, tenant_id: uuid.UUID) -> bool:
    extra = _tenant_settings(tenant_id).get("staff_document_types") or []
    return document_type in DEFAULT_DOCUMENT_TYPES or document_type in extra


def assert_document_type_allowed(*, document_type: str, tenant_id: uuid.UUID) -> None:
    if not _document_type_allowed(document_type=document_type, tenant_id=tenant_id):
        raise DomainRuleViolation(
            {"document_type": f"'{document_type}' is not a recognised document type."}
        )


def assert_file_usable(*, file, purpose: str):
    """Check a resolved File instance matches the caller's intended purpose and

    is ready — mirrors student_management.services.assert_file_usable exactly.
    """
    if file.purpose != purpose:
        raise DomainRuleViolation(
            {"non_field": f"This file was uploaded for '{file.purpose}', not '{purpose}'."}
        )
    if file.status != "ready":
        raise DomainRuleViolation({"non_field": "This file's upload has not been confirmed yet."})
    return file


@transaction.atomic
def create_staff(
    *,
    campus,
    joining_date: date,
    first_name: str,
    last_name: str,
    staff_type: str,
    phone: str,
    department=None,
    designation=None,
    reports_to=None,
    user_id: uuid.UUID | None = None,
    photo_file=None,
    gender: str | None = None,
    date_of_birth=None,
    employment_type: str | None = None,
    email: str | None = None,
    national_id: str | None = None,
    public_bio: str | None = None,
    address: dict | None = None,
    custom_fields: dict | None = None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> Staff:
    """Create a staff record, allocating its employee number in the same

    transaction. Order: department/designation/national-id checks -> user_id
    tenant check -> number allocation -> insert, so a rejected create never
    consumes a sequence value — mirrors create_student's ordering rule.
    """
    if department is not None:
        assert_department_active(department=department, tenant_id=tenant_id)
    if designation is not None:
        assert_designation_active(designation=designation, tenant_id=tenant_id)
    if reports_to is not None:
        assert_reports_to_acyclic(staff=None, reports_to=reports_to)
    if national_id:
        assert_national_id_available(tenant_id=tenant_id, national_id=national_id, instance=None)
    checked_user_id = resolve_tenant_user_id(user_id=user_id, tenant_id=tenant_id)
    if photo_file is not None:
        assert_file_usable(file=photo_file, purpose=uploads.STAFF_PHOTO.key)

    employee_number = allocate_employee_number(
        campus=campus, joining_date=joining_date, tenant_id=tenant_id
    )

    return Staff.objects.create(
        tenant_id=tenant_id,
        employee_number=employee_number,
        user_id=checked_user_id,
        first_name=first_name,
        last_name=last_name,
        gender=gender or Gender.UNSPECIFIED,
        date_of_birth=date_of_birth,
        photo_file=photo_file,
        staff_type=staff_type,
        campus=campus,
        department=department,
        designation=designation,
        reports_to=reports_to,
        employment_type=employment_type or "full_time",
        joining_date=joining_date,
        email=email,
        phone=phone,
        national_id=national_id,
        public_bio=public_bio,
        address=address,
        custom_fields=custom_fields or {},
        created_by=actor_id,
        updated_by=actor_id,
    )


@transaction.atomic
def add_staff_qualification(
    *,
    staff: Staff,
    qualification_type: str,
    title: str,
    institution: str | None = None,
    field_of_study: str | None = None,
    year_awarded: int | None = None,
    grade: str | None = None,
    document_file=None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> StaffQualification:
    if year_awarded is not None:
        assert_year_not_future(year_awarded)
    if document_file is not None:
        assert_file_usable(file=document_file, purpose=uploads.STAFF_QUALIFICATION.key)

    return StaffQualification.objects.create(
        tenant_id=tenant_id,
        staff=staff,
        qualification_type=qualification_type,
        title=title,
        institution=institution,
        field_of_study=field_of_study,
        year_awarded=year_awarded,
        grade=grade,
        document_file=document_file,
        created_by=actor_id,
        updated_by=actor_id,
    )


@transaction.atomic
def _verify_record(*, instance, decision: str, actor_id: uuid.UUID, label: str):
    """Accept or reject a verification_status/verified_by/verified_at record.

    Generic over StaffQualification and StaffDocument — both expose the same
    four audit fields and the same VerificationStatus enum.

    Re-fetches with select_for_update() rather than trusting the caller's already-read
    `instance`: without a lock, two concurrent :verify calls on the same row could both
    read PENDING, both pass the guard below, and race to overwrite each other's decision
    with no error surfaced to either caller. The second call now blocks until the first
    commits, then sees the real (already-decided) status.
    """
    locked = type(instance).objects.select_for_update().get(pk=instance.pk)
    if locked.verification_status != VerificationStatus.PENDING:
        raise Conflict(f"This {label} was already {locked.verification_status}.")
    locked.verification_status = decision
    locked.verified_by = actor_id
    locked.verified_at = timezone.now()
    locked.updated_by = actor_id
    locked.save(
        update_fields=[
            "verification_status",
            "verified_by",
            "verified_at",
            "updated_by",
            "updated_at",
        ]
    )
    return locked


def verify_qualification(
    *, qualification: StaffQualification, decision: str, actor_id: uuid.UUID
) -> StaffQualification:
    return _verify_record(
        instance=qualification, decision=decision, actor_id=actor_id, label="qualification"
    )


@transaction.atomic
def add_staff_document(
    *,
    staff: Staff,
    file,
    document_type: str,
    title: str,
    notes: str | None = None,
    expires_at=None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> StaffDocument:
    assert_document_type_allowed(document_type=document_type, tenant_id=tenant_id)
    assert_file_usable(file=file, purpose=uploads.STAFF_DOCUMENT.key)

    return StaffDocument.objects.create(
        tenant_id=tenant_id,
        staff=staff,
        file=file,
        document_type=document_type,
        title=title,
        notes=notes,
        expires_at=expires_at,
        created_by=actor_id,
        updated_by=actor_id,
    )


def verify_document(
    *, document: StaffDocument, decision: str, actor_id: uuid.UUID
) -> StaffDocument:
    """Accept or reject a document — mirrors student_management's identical

    rejection of re-verifying an already-decided document.
    """
    return _verify_record(instance=document, decision=decision, actor_id=actor_id, label="document")


@transaction.atomic
def invite_staff(*, staff: Staff, role_ids: list[uuid.UUID], actor_id: uuid.UUID) -> Staff:
    """Create the tenant-scoped portal account and link + role-assign it.

    Emits ``staff.invited`` through ``core.notifications``, which now exists —
    but **in-app only**, and the remaining gap is worth stating precisely rather
    than calling this done. The account is still inactive (``is_active=False``)
    with an unusable password, because no set-password/SSO onboarding flow exists
    yet; an *email* saying "your account is ready" would therefore be untrue, so
    the trigger deliberately does not declare that channel (see
    ``notifications.py``). The inbox entry is honest — it is waiting for the
    recipient when they can first sign in.

    What is still missing is the onboarding flow itself, not the notification
    layer: an activation token endpoint plus the email that carries it. Adding
    ``NotificationChannel.EMAIL`` to the trigger is the one-line change once it
    lands. Documented in the same honest style as
    ``core.files.File.av_scanned_at``'s "no scanner is wired up yet".
    """
    if staff.user_id is not None:
        raise Conflict("This staff member already has a linked account.")
    if staff.employment_status in (
        EmploymentStatus.RESIGNED,
        EmploymentStatus.RETIRED,
        EmploymentStatus.TERMINATED,
    ):
        raise Conflict(f"This staff member has already exited ({staff.employment_status}).")

    from django.db.models import Q

    from core.rbac.models import Role, User, UserRole

    if not staff.email:
        raise DomainRuleViolation(
            {"non_field": "An email address is required to invite this staff member."}
        )

    user = User.objects.create(
        tenant_id=staff.tenant_id,
        email=staff.email,
        first_name=staff.first_name,
        last_name=staff.last_name,
        phone=staff.phone,
        is_active=False,
    )
    user.set_unusable_password()
    user.save(update_fields=["password"])

    # A role_id may name either a tenant-custom role or a platform-seeded
    # default role (Role.tenant is null for those) — both are valid targets.
    roles = list(
        Role.objects.filter(pk__in=role_ids).filter(
            Q(tenant_id=staff.tenant_id) | Q(tenant__isnull=True)
        )
    )
    if len(roles) != len(set(role_ids)):
        raise DomainRuleViolation(
            {"role_ids": "One or more role ids do not exist for your school."}
        )
    UserRole.objects.bulk_create(
        [UserRole(user=user, role=role, tenant_id=staff.tenant_id) for role in roles]
    )

    staff.user_id = user.pk
    staff.updated_by = actor_id
    staff.save(update_fields=["user_id", "updated_by", "updated_at"])

    _notify_invited(staff=staff, user_id=user.pk)
    return staff


def _notify_invited(*, staff: Staff, user_id: uuid.UUID) -> None:
    """Emit `staff.invited`. Never lets a notification failure undo the invite.

    The account and its role assignments are the actual outcome of `:invite`;
    a template or transport problem must not roll those back, so this swallows
    and logs rather than propagating — the same reasoning as
    `core.audit.services.record_audit`, which is also savepointed for it.
    """
    from core.notifications.services import Recipient, notify
    from core.tenancy.models import Tenant

    try:
        with transaction.atomic():
            notify(
                notifications.STAFF_INVITED,
                tenant_id=staff.tenant_id,
                recipients=[Recipient(user_id=user_id)],
                context={
                    "staff.first_name": staff.first_name,
                    "school.name": Tenant.objects.get(pk=staff.tenant_id).name,
                },
                source_type="staff",
                source_id=staff.pk,
            )
    except Exception:
        logger.exception("staff.invited notification failed for staff %s", staff.pk)


def is_sole_class_teacher(*, staff: Staff) -> bool:
    """§11: exit is blocked while the staff member is the sole class teacher

    for any section — imported lazily to avoid a hard import-time dependency
    on school_organization beyond what the module doc already declares.
    """
    from apps.school_organization.models import Section

    return Section.objects.alive().filter(class_teacher_staff_id=staff.pk).exists()


def has_direct_reports(*, staff: Staff) -> bool:
    """§11: exit is blocked while other staff still report to this one."""
    return Staff.objects.alive().filter(reports_to_id=staff.pk).exists()


def is_referenced_as_head(*, staff: Staff) -> bool:
    """§11: exit is blocked while this staff heads a campus or department."""
    from apps.school_organization.models import Campus, Department

    return (
        Campus.objects.alive().filter(head_staff_id=staff.pk).exists()
        or Department.objects.alive().filter(head_staff_id=staff.pk).exists()
    )


def is_referenced_as_house_master(*, staff: Staff) -> bool:
    """§11: exit is blocked while this staff is set as a house master."""
    from apps.school_organization.models import House

    return House.objects.alive().filter(house_master_staff_id=staff.pk).exists()


def clearance_blockers(staff: Staff) -> list[str]:
    """Exit clearance checks (§7 exit workflow). Assets/advances/allocation

    clearance always return "clear" because those modules don't exist yet —
    exactly as student_management's withdrawal clearance does.
    """
    blockers = []
    if is_sole_class_teacher(staff=staff):
        blockers.append(
            "This staff member is the class teacher for one or more sections. "
            "Reassign those sections before exiting them."
        )
    if has_direct_reports(staff=staff):
        blockers.append(
            "One or more staff members report to this staff member. Reassign their "
            "reporting line before exiting them."
        )
    if is_referenced_as_head(staff=staff):
        blockers.append(
            "This staff member is set as the head of a campus or department. "
            "Reassign that headship before exiting them."
        )
    if is_referenced_as_house_master(staff=staff):
        blockers.append(
            "This staff member is set as a house master. Reassign that house before exiting them."
        )
    return blockers


@transaction.atomic
def exit_staff(
    *,
    staff: Staff,
    exit_date: date,
    exit_reason: str,
    actor_id: uuid.UUID,
    exit_type: str = EmploymentStatus.RESIGNED,
) -> Staff:
    if staff.employment_status in (
        EmploymentStatus.RESIGNED,
        EmploymentStatus.RETIRED,
        EmploymentStatus.TERMINATED,
    ):
        raise Conflict(f"This staff member has already exited ({staff.employment_status}).")
    if exit_date < staff.joining_date:
        raise DomainRuleViolation({"exit_date": "exit_date must be on or after joining_date."})
    blockers = clearance_blockers(staff)
    if blockers:
        raise DomainRuleViolation({"non_field": " ".join(blockers)})

    staff.employment_status = exit_type
    staff.exit_date = exit_date
    staff.exit_reason = exit_reason
    staff.updated_by = actor_id
    staff.save(
        update_fields=["employment_status", "exit_date", "exit_reason", "updated_by", "updated_at"]
    )
    if staff.user_id is not None:
        # An exited employee must not keep portal access or role assignments —
        # UserRole has no soft-delete field, so it's removed outright rather
        # than deactivated.
        from core.rbac.models import User, UserRole

        User.objects.filter(pk=staff.user_id).update(is_active=False)
        UserRole.objects.filter(user_id=staff.user_id, tenant_id=staff.tenant_id).delete()
    return staff


# Column mapping for arbitrary legacy headers is not built (same gap as
# student_management's importer) — the template's exact header names are
# required. Optional columns may be blank; REQUIRED_IMPORT_COLUMNS must all
# have a value.
IMPORT_COLUMNS = (
    "first_name",
    "last_name",
    "staff_type",
    "campus_code",
    "joining_date",
    "phone",
    "gender",
    "date_of_birth",
    "email",
    "national_id",
)
REQUIRED_IMPORT_COLUMNS = (
    "first_name",
    "last_name",
    "staff_type",
    "campus_code",
    "joining_date",
    "phone",
)


def parse_import_rows(*, filename: str, data: bytes) -> list[dict[str, str]]:
    """Parse a staff-import file (CSV or .xlsx) into row dicts keyed by

    IMPORT_COLUMNS's header names — mirrors student_management's parser
    exactly (same two formats, same header-driven contract).
    """
    if filename.lower().endswith(".xlsx"):
        return _parse_import_xlsx(data)
    return _parse_import_csv(data)


def _parse_import_csv(data: bytes) -> list[dict[str, str]]:
    import csv
    import io

    # utf-8-sig strips a BOM if Excel's "CSV UTF-8" added one.
    text = data.decode("utf-8-sig")
    reader = csv.DictReader(io.StringIO(text))
    rows: list[dict[str, str]] = []
    for row in reader:
        entry = {k: (v or "") for k, v in row.items()}
        # DictReader silently skips a fully blank physical line (row == []), so a plain
        # by-position index would drift from the real file row the moment one appears.
        # reader.line_num already accounts for every line consumed, skipped or not.
        entry["__row_number__"] = str(reader.line_num)
        rows.append(entry)
    return rows


def _parse_import_xlsx(data: bytes) -> list[dict[str, str]]:
    import io

    import openpyxl

    workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    sheet = workbook.active
    rows_iter = sheet.iter_rows(values_only=True)
    header = [str(cell).strip() if cell is not None else "" for cell in next(rows_iter)]

    rows: list[dict[str, str]] = []
    for sheet_row, values in enumerate(rows_iter, start=2):  # header occupies row 1
        if all(value is None for value in values):
            # Skipped, not appended — a plain by-position index into `rows` would
            # otherwise drift from the real sheet row the moment one of these appears.
            # __row_number__ below is what keeps every downstream error message correct.
            continue
        try:
            entry = {
                header[i]: ("" if values[i] is None else str(values[i])) for i in range(len(header))
            }
        except IndexError:
            # A row with fewer trailing cells than the header — record it as a
            # per-row error instead of failing the whole import (see
            # import_staff_row's matching __parse_error__ check below).
            entry = {"__parse_error__": f"Row {sheet_row} has fewer columns than the header row."}
        entry["__row_number__"] = str(sheet_row)
        rows.append(entry)
    return rows


def import_staff_row(
    *, row: dict[str, str], tenant_id: uuid.UUID, actor_id: uuid.UUID
) -> dict[str, str] | None:
    """Create one staff record from a parsed import row.

    Returns ``None`` on success, or ``{"row", "field", "issue"}`` on failure.
    Each row commits (or rolls back) independently — one bad row must not
    abort the whole batch, mirroring import_student_row exactly.

    The reported row number comes from ``row["__row_number__"]`` (set by both
    ``_parse_import_csv`` and ``_parse_import_xlsx``) rather than the row's position in
    the parsed list — a blank physical row is silently dropped by both parsers, so a
    by-position index would drift from the real file row after the first one.
    """
    import datetime

    from apps.school_organization.models import Campus

    row_number = row["__row_number__"]

    if "__parse_error__" in row:
        return {"row": row_number, "field": "non_field", "issue": row["__parse_error__"]}

    missing = [column for column in REQUIRED_IMPORT_COLUMNS if not row.get(column)]
    if missing:
        field = missing[0]
        return {
            "row": row_number,
            "field": field,
            "issue": f"Missing required value for '{field}'.",
        }

    try:
        joining_date = datetime.date.fromisoformat(row["joining_date"])
        date_of_birth = (
            datetime.date.fromisoformat(row["date_of_birth"]) if row.get("date_of_birth") else None
        )
    except ValueError:
        return {
            "row": row_number,
            "field": "joining_date",
            "issue": "Dates must be in YYYY-MM-DD format.",
        }

    # One transaction for the whole row (tenant GUC re-applied via
    # tenant_atomic) — this is what makes each row commit independently.
    try:
        with tenant_atomic(tenant_id):
            try:
                campus = Campus.objects.alive().get(code=row["campus_code"])
            except Campus.DoesNotExist:
                return {
                    "row": str(row_number),
                    "field": "campus_code",
                    "issue": f"No campus with code '{row['campus_code']}'.",
                }
            except Campus.MultipleObjectsReturned:
                # The campus-code uniqueness constraint is scoped to non-deleted rows
                # only, so a code reused after a soft-delete can match more than one
                # row here without .alive() — report it as an import error rather than
                # letting the exception fail the whole batch.
                return {
                    "row": str(row_number),
                    "field": "campus_code",
                    "issue": f"More than one campus has code '{row['campus_code']}'.",
                }
            create_staff(
                campus=campus,
                joining_date=joining_date,
                first_name=row["first_name"],
                last_name=row["last_name"],
                staff_type=row["staff_type"],
                phone=row["phone"],
                gender=row.get("gender") or None,
                date_of_birth=date_of_birth,
                email=row.get("email") or None,
                national_id=row.get("national_id") or None,
                actor_id=actor_id,
                tenant_id=tenant_id,
            )
    except DomainRuleViolation as exc:
        detail = exc.detail
        if isinstance(detail, dict) and detail:
            field, issue = next(iter(detail.items()))
            return {"row": str(row_number), "field": str(field), "issue": str(issue)}
        return {"row": str(row_number), "field": "non_field", "issue": str(detail)}
    except IntegrityError:
        return {
            "row": str(row_number),
            "field": "non_field",
            "issue": "This row conflicts with existing data.",
        }
    return None


def build_staff_export_csv(*, tenant_id: uuid.UUID) -> bytes:
    """All of a tenant's staff as CSV (module doc §16, staff.staff.export).

    Not record-scope-narrowed: export is admin-only (STAFF_IO —
    hr_staff/it_admin) — mirrors build_student_export_csv's identical
    reasoning.
    """
    import csv
    import io

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow(
        [
            "employee_number",
            "first_name",
            "last_name",
            "staff_type",
            "campus_code",
            "employment_status",
            "joining_date",
        ]
    )
    with tenant_atomic(tenant_id):
        staff_rows = list(
            Staff.objects.alive().select_related("campus").order_by("last_name", "first_name")
        )
    for staff in staff_rows:
        writer.writerow(
            [
                staff.employee_number,
                staff.first_name,
                staff.last_name,
                staff.staff_type,
                staff.campus.code,
                staff.employment_status,
                staff.joining_date.isoformat(),
            ]
        )
    return buffer.getvalue().encode("utf-8")
