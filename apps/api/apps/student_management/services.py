"""Business rules for the student-management module.

Views stay thin: everything here is a rule from
docs/03-modules/student-management.md §6 (sub-features) and §11
(validations). Keeping it out of serializers means the same rules apply to the
API, the bulk importer (a later PR) and any Celery job, none of which go through
a serializer.
"""

from __future__ import annotations

import hashlib
import re
import uuid
from collections.abc import Callable
from datetime import date

from django.db import connection, transaction
from django.utils import timezone

from apps.school_organization.models import Section
from apps.school_organization.services import assert_section_capacity, assert_session_writable
from apps.student_management.models import (
    EmergencyContact,
    EnrollmentStatus,
    Guardian,
    Student,
    StudentDocument,
    StudentEnrollment,
    StudentGuardian,
    StudentStatus,
    StudentTransfer,
    TransferStatus,
    TransferType,
)
from core.api.exceptions import Conflict, DomainRuleViolation
from core.tenancy.sequences import allocate_number

# Pattern tokens the admission-number template may use. Anything else in the
# pattern is left as a literal character, never evaluated — see
# render_admission_number's docstring for why.
_PATTERN_TOKEN = re.compile(r"\{(campus|year)\}|\{seq(?::0(\d+)d)?\}")
# Any `{...}` span at all, used only to catch a pattern that LOOKS like it meant
# to use a token but doesn't match one of the three known-good shapes above
# (e.g. a typo'd `{seq:2d}` missing the leading zero) — see
# assert_pattern_tokens_valid's docstring for why that must be a loud, rejected
# config error rather than a silently-literal substring.
_ANY_BRACE_TOKEN = re.compile(r"\{[^}]*\}")

_DEFAULT_PATTERN = "{year}-{seq:04d}"


def resolve_tenant_user_id(*, user_id: uuid.UUID | None, tenant_id: uuid.UUID) -> uuid.UUID | None:
    """Tenant-checked resolution of a portal-account link.

    ``Student.user_id`` is a plain UUID column rather than a ForeignKey — see the
    model docstring — precisely so this check exists explicitly instead of being
    implied by a queryset that would happily resolve another tenant's user.
    """
    if user_id is None:
        return None

    from core.rbac.models import User

    # User.objects (UserManager) is deliberately unfiltered — see the model's own
    # docstring — so the explicit tenant_id= filter here is the entire safety
    # check; there is no all_tenants manager to fall back on for this model.
    exists = User.objects.filter(pk=user_id, tenant_id=tenant_id).exists()
    if not exists:
        raise DomainRuleViolation({"user_id": "No user with this id exists for your school."})
    return user_id


def assert_pattern_tokens_valid(pattern: str) -> None:
    """Reject a pattern containing a `{...}` block that isn't a known token.

    _PATTERN_TOKEN's substitution is a deliberate allowlist (see
    _substitute_tokens's docstring) that leaves anything it doesn't recognize as
    a literal, unsubstituted substring — silently correct for a pattern with no
    braces, but silently *wrong* for a typo'd token like `{seq:2d}` (missing the
    leading zero): every student in that campus+year would render that literal
    text verbatim, with no sequence number ever substituted in. Fail loudly at
    config-read time instead of producing that garbage.
    """
    for token in _ANY_BRACE_TOKEN.findall(pattern):
        if not _PATTERN_TOKEN.fullmatch(token):
            raise DomainRuleViolation(
                {
                    "admission_number_pattern": (
                        f"'{token}' is not a recognized token. Use {{campus}}, {{year}}, "
                        "{seq}, or {seq:0Nd}."
                    )
                }
            )


def _substitute_tokens(
    pattern: str, *, campus: str, year: str, seq: Callable[[str | None], str]
) -> str:
    """Shared {campus}/{year}/{seq[:0Nd]} token dispatch against _PATTERN_TOKEN.

    Deliberately NOT ``pattern.format(**ctx)``: a tenant-controlled format string
    is an injection surface (``"{__class__}"``, ``"{0.__init__.__globals__}"``
    would both be valid ``str.format`` attribute-access syntax). A regex
    allowlist substitution can only ever produce the three token shapes it knows
    about; every other ``{...}`` in the pattern is left untouched rather than
    evaluated (assert_pattern_tokens_valid is what turns "untouched" into a
    loud config error instead of silent garbage).
    """

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


def admission_number_series(*, pattern: str, campus_code: str, admission_date: date) -> str:
    """The counter's series key: the pattern rendered with the sequence token blanked.

    Two admission numbers sharing everything except the sequence must share one
    counter; two whose campus or year differ must not — this is what makes that
    true without a second table. Blanking (not rendering `sequence=0`) matters:
    a pattern like `"{campus}{year}-{seq:04d}"` with a literal zero-padded `0000`
    baked into the series would make every sequence collide on a stray `0`
    appearing elsewhere in the rendered string.
    """
    return _substitute_tokens(
        pattern, campus=campus_code, year=str(admission_date.year), seq=lambda width: ""
    )


def render_admission_number(
    *, pattern: str, campus_code: str, admission_date: date, sequence: int
) -> str:
    return _render_pattern(
        pattern, campus_code=campus_code, year=str(admission_date.year), sequence=sequence
    )


@transaction.atomic
def allocate_admission_number(*, campus, admission_date: date, tenant_id: uuid.UUID) -> str:
    """Generate and reserve the next admission number for ``campus``/``admission_date``.

    Must run inside the same transaction as the Student insert — allocate_number
    asserts this — so a create that fails afterward does not burn the number
    (module doc §6: "sequence gaps never reused" reads as "never reused *once
    committed*"; a rolled-back allocation was never issued).
    """
    tenant_settings = _tenant_settings(tenant_id)
    pattern = (tenant_settings.get("admission_number_pattern") or _DEFAULT_PATTERN).strip()
    if not pattern:
        pattern = _DEFAULT_PATTERN
    assert_pattern_tokens_valid(pattern)

    series = admission_number_series(
        pattern=pattern, campus_code=campus.code, admission_date=admission_date
    )
    sequence = allocate_number(scope="admission_number", series=series, tenant_id=tenant_id)
    return render_admission_number(
        pattern=pattern, campus_code=campus.code, admission_date=admission_date, sequence=sequence
    )


def _tenant_settings(tenant_id: uuid.UUID) -> dict:
    from core.tenancy.models import TenantSettings

    row = TenantSettings.all_tenants.filter(tenant_id=tenant_id).first()
    return (row.academic or {}) if row else {}


def duplicate_candidates(*, first_name: str, last_name: str, date_of_birth: date):
    """Students matching on (first_name, last_name, date_of_birth), case-insensitive.

    Exact match. The module doc §6 names a fuzzy name+DOB+guardian-phone match as
    the eventual target, but `POST /students` takes no guardian payload — a
    student is created standalone and guardians are linked afterward via
    `POST /students/{id}/guardians` (this PR) — so there is no guardian phone
    available at the point this check runs. The admissions handoff (Tier 6,
    §7.1), which creates student+guardians together, is the natural place to
    add the guardian-phone signal; conservative exact matching is what ships
    until that caller exists, per §19's note on conservative defaults.
    """
    return Student.objects.alive().filter(
        first_name__iexact=first_name, last_name__iexact=last_name, date_of_birth=date_of_birth
    )


def _duplicate_check_lock_key(
    *, tenant_id: uuid.UUID, first_name: str, last_name: str, date_of_birth: date
) -> int:
    """A stable bigint key for pg_advisory_xact_lock, one per (tenant, name, DOB).

    Not a DB unique constraint: assert_not_duplicate is deliberately advisory —
    override_reason lets a caller bypass it for a legitimate case (twins), which
    a hard constraint can't conditionally honor — so the concurrency fix has to
    be a lock, not a constraint. Session-scoped pg_advisory_lock is prohibited
    under this codebase's PgBouncer transaction-pooling mode (see
    docs/02-architecture/database-architecture.md §1.1); pg_advisory_xact_lock
    is transaction-scoped and auto-releases at commit/rollback, so it fits.
    """
    digest = hashlib.sha256(
        f"{tenant_id}:{first_name.lower()}:{last_name.lower()}:{date_of_birth.isoformat()}".encode()
    ).digest()
    # Postgres advisory lock keys are signed 64-bit ints; interpret the first 8
    # bytes as signed so every digest maps to a valid key.
    return int.from_bytes(digest[:8], byteorder="big", signed=True)


def assert_not_duplicate(
    *,
    tenant_id: uuid.UUID,
    first_name: str,
    last_name: str,
    date_of_birth: date,
    override_reason: str | None = None,
) -> None:
    if override_reason:
        return
    with connection.cursor() as cursor:
        cursor.execute(
            "SELECT pg_advisory_xact_lock(%s)",
            [
                _duplicate_check_lock_key(
                    tenant_id=tenant_id,
                    first_name=first_name,
                    last_name=last_name,
                    date_of_birth=date_of_birth,
                )
            ],
        )
    duplicate = duplicate_candidates(
        first_name=first_name, last_name=last_name, date_of_birth=date_of_birth
    ).first()
    if duplicate is not None:
        raise DomainRuleViolation(
            {
                "non_field": (
                    f"A student named '{first_name} {last_name}' with the same date of "
                    f"birth already exists (admission number {duplicate.admission_number}). "
                    "Pass an override reason to create anyway."
                )
            }
        )


def assert_admission_number_immutable(*, instance: Student, new_value: str | None) -> None:
    if new_value is not None and new_value != instance.admission_number:
        raise DomainRuleViolation(
            {"admission_number": "admission_number is immutable after creation."}
        )


@transaction.atomic
def create_student(
    *,
    campus,
    admission_date: date,
    date_of_birth: date,
    first_name: str,
    last_name: str,
    gender: str,
    house=None,
    preferred_name: str | None = None,
    user_id: uuid.UUID | None = None,
    photo_file=None,
    blood_group: str | None = None,
    nationality: str | None = None,
    religion: str | None = None,
    previous_school: str | None = None,
    medical_notes: str | None = None,
    address: dict | None = None,
    custom_fields: dict | None = None,
    duplicate_override_reason: str | None = None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> Student:
    """Create a student, allocating its admission number in the same transaction.

    The order matters: duplicate check -> user_id tenant check -> number
    allocation -> insert. Number allocation happens last among the checks so a
    rejected create never consumes a sequence value.
    """
    assert_not_duplicate(
        tenant_id=tenant_id,
        first_name=first_name,
        last_name=last_name,
        date_of_birth=date_of_birth,
        override_reason=duplicate_override_reason,
    )
    checked_user_id = resolve_tenant_user_id(user_id=user_id, tenant_id=tenant_id)
    if photo_file is not None:
        assert_file_usable(file=photo_file, purpose="student.photo")

    admission_number = allocate_admission_number(
        campus=campus, admission_date=admission_date, tenant_id=tenant_id
    )

    return Student.objects.create(
        tenant_id=tenant_id,
        admission_number=admission_number,
        user_id=checked_user_id,
        first_name=first_name,
        last_name=last_name,
        preferred_name=preferred_name,
        date_of_birth=date_of_birth,
        gender=gender,
        photo_file=photo_file,
        campus=campus,
        house=house,
        admission_date=admission_date,
        blood_group=blood_group,
        nationality=nationality,
        religion=religion,
        previous_school=previous_school,
        medical_notes=medical_notes,
        address=address,
        custom_fields=custom_fields or {},
        created_by=actor_id,
        updated_by=actor_id,
    )


def assert_file_usable(*, file, purpose: str):
    """Check a resolved File instance matches the caller's intended purpose and is ready.

    Tenant scoping and existence are already handled by the serializer's `_fk()`
    field (a `PrimaryKeyRelatedField` bound to the tenant-scoped manager) before
    this ever runs — what that field cannot express is "and it's the right kind
    of file, and the upload actually finished".
    """
    if file.purpose != purpose:
        raise DomainRuleViolation(
            {"non_field": f"This file was uploaded for '{file.purpose}', not '{purpose}'."}
        )
    if file.status != "ready":
        raise DomainRuleViolation({"non_field": "This file's upload has not been confirmed yet."})
    return file


@transaction.atomic
def link_guardian(
    *,
    student: Student,
    guardian: Guardian,
    relationship: str,
    is_primary: bool = False,
    is_fee_responsible: bool = False,
    can_pick_up: bool = True,
    receives_communications: bool = True,
    has_portal_access: bool = True,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> StudentGuardian:
    """Link a guardian to a student. Demotes any incumbent primary first — see

    set_primary_guardian's docstring for why that ordering is load-bearing.
    """
    if is_primary:
        _demote_primary_guardian(student=student, actor_id=actor_id)

    return StudentGuardian.objects.create(
        tenant_id=tenant_id,
        student=student,
        guardian=guardian,
        relationship=relationship,
        is_primary=is_primary,
        is_fee_responsible=is_fee_responsible,
        can_pick_up=can_pick_up,
        receives_communications=receives_communications,
        has_portal_access=has_portal_access,
        created_by=actor_id,
        updated_by=actor_id,
    )


def _demote_primary_guardian(*, student: Student, actor_id: uuid.UUID) -> None:
    StudentGuardian.objects.alive().filter(student=student, is_primary=True).update(
        is_primary=False, updated_by=actor_id
    )


@transaction.atomic
def set_primary_guardian(
    *, student: Student, link: StudentGuardian, actor_id: uuid.UUID
) -> StudentGuardian:
    """Promote `link` to primary, demoting the incumbent first.

    Must demote before promoting: the partial unique index
    (`student_guardians_one_primary_per_student`) is checked per statement, so
    writing two primaries and fixing it up afterwards raises instead of
    succeeding — the same trap school_organization's `clear_primary_campus`
    documents.
    """
    _demote_primary_guardian(student=student, actor_id=actor_id)
    link.is_primary = True
    link.updated_by = actor_id
    link.save(update_fields=["is_primary", "updated_by", "updated_at"])
    return link


def add_emergency_contact(
    *,
    student: Student,
    name: str,
    relationship: str,
    phone: str,
    alt_phone: str | None = None,
    priority: int = 1,
    notes: str | None = None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> EmergencyContact:
    return EmergencyContact.objects.create(
        tenant_id=tenant_id,
        student=student,
        name=name,
        relationship=relationship,
        phone=phone,
        alt_phone=alt_phone,
        priority=priority,
        notes=notes,
        created_by=actor_id,
        updated_by=actor_id,
    )


def _document_type_allowed(*, document_type: str, tenant_id: uuid.UUID) -> bool:
    from apps.student_management.models import DEFAULT_DOCUMENT_TYPES

    extra = _tenant_settings(tenant_id).get("student_document_types") or []
    return document_type in DEFAULT_DOCUMENT_TYPES or document_type in extra


def assert_document_type_allowed(*, document_type: str, tenant_id: uuid.UUID) -> None:
    if not _document_type_allowed(document_type=document_type, tenant_id=tenant_id):
        raise DomainRuleViolation(
            {"document_type": f"'{document_type}' is not a recognised document type."}
        )


@transaction.atomic
def add_student_document(
    *,
    student: Student,
    file,
    document_type: str,
    title: str,
    notes: str | None = None,
    expires_at=None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> StudentDocument:
    assert_document_type_allowed(document_type=document_type, tenant_id=tenant_id)
    assert_file_usable(file=file, purpose="student.document")

    return StudentDocument.objects.create(
        tenant_id=tenant_id,
        student=student,
        file=file,
        document_type=document_type,
        title=title,
        notes=notes,
        expires_at=expires_at,
        created_by=actor_id,
        updated_by=actor_id,
    )


@transaction.atomic
def verify_document(
    *, document: StudentDocument, decision: str, actor_id: uuid.UUID
) -> StudentDocument:
    """Accept or reject a document. `decision` is 'verified' or 'rejected'.

    Rejects re-verifying an already-decided document rather than silently
    overwriting a prior verifier — a correction is a new decision an operator
    should make deliberately, not a side effect of clicking the button twice.
    """
    if document.verification_status != "pending":
        raise Conflict(f"This document was already {document.verification_status}.")

    document.verification_status = decision
    document.verified_by = actor_id
    document.verified_at = timezone.now()
    document.updated_by = actor_id
    document.save(
        update_fields=[
            "verification_status",
            "verified_by",
            "verified_at",
            "updated_by",
            "updated_at",
        ]
    )
    return document


def assert_student_active(student: Student) -> None:
    if student.status != StudentStatus.ACTIVE:
        raise DomainRuleViolation({"non_field": f"Student is {student.status}, not active."})


def assert_section_belongs_to_class(*, section: Section, school_class) -> None:
    if section.school_class_id != school_class.pk:
        raise DomainRuleViolation({"section_id": "Section does not belong to the given class."})


def assert_date_in_session(*, session, enrollment_date: date) -> None:
    if not (session.start_date <= enrollment_date <= session.end_date):
        raise DomainRuleViolation(
            {"enrollment_date": "Date falls outside the academic session's window."}
        )


def assert_enrollment_prerequisites(student: Student) -> None:
    """Module doc §11: enrolling requires at least one guardian and one emergency contact."""
    if not StudentGuardian.objects.alive().filter(student=student).exists():
        raise DomainRuleViolation(
            {"non_field": "Student needs at least one guardian before enrolling."}
        )
    if not EmergencyContact.objects.alive().filter(student=student).exists():
        raise DomainRuleViolation(
            {"non_field": "Student needs at least one emergency contact before enrolling."}
        )


def active_enrollment(student: Student) -> StudentEnrollment | None:
    return (
        StudentEnrollment.objects.alive()
        .filter(student=student, status=EnrollmentStatus.ACTIVE)
        .first()
    )


def _assert_capacity(
    *,
    section: Section,
    exclude_enrollment_id=None,
    capacity_override_reason,
    actor_has_capacity_override,
) -> None:
    """Lock ``section``, count its active occupants, and enforce capacity — or

    require both a reason and the override permission to skip that check
    (module doc §11: "override requires school_admin + reason, audited").
    """
    locked_section = Section.objects.select_for_update().get(pk=section.pk)
    occupied_qs = StudentEnrollment.objects.alive().filter(
        section=locked_section, status=EnrollmentStatus.ACTIVE
    )
    if exclude_enrollment_id is not None:
        occupied_qs = occupied_qs.exclude(pk=exclude_enrollment_id)
    occupied = occupied_qs.count()

    if capacity_override_reason:
        if not actor_has_capacity_override:
            raise DomainRuleViolation(
                {
                    "capacity_override_reason": (
                        "Only an admin holding students.student.update may override "
                        "section capacity."
                    )
                }
            )
    else:
        assert_section_capacity(locked_section, occupied=occupied)


@transaction.atomic
def enroll_student(
    *,
    student: Student,
    academic_session,
    school_class,
    section: Section,
    enrollment_date: date,
    roll_number: str | None = None,
    capacity_override_reason: str | None = None,
    actor_has_capacity_override: bool = False,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> StudentEnrollment:
    """Enroll ``student`` into a session/class/section (module doc §7.1, §11).

    Ordering matters: session-writable -> student-active -> prerequisites
    (>=1 guardian, >=1 emergency contact) -> section-belongs-to-class ->
    date-in-session -> lock the section row -> count active occupants under
    that lock -> capacity check -> create. Locking after the cheap checks and
    before the expensive count is what makes the capacity check race-safe
    under concurrent enrollments into the same section.
    """
    assert_session_writable(academic_session)
    assert_student_active(student)
    assert_enrollment_prerequisites(student)
    assert_section_belongs_to_class(section=section, school_class=school_class)
    assert_date_in_session(session=academic_session, enrollment_date=enrollment_date)
    _assert_capacity(
        section=section,
        capacity_override_reason=capacity_override_reason,
        actor_has_capacity_override=actor_has_capacity_override,
    )

    return StudentEnrollment.objects.create(
        tenant_id=tenant_id,
        student=student,
        academic_session=academic_session,
        school_class=school_class,
        section=section,
        roll_number=roll_number,
        enrollment_date=enrollment_date,
        status=EnrollmentStatus.ACTIVE,
        created_by=actor_id,
        updated_by=actor_id,
    )


@transaction.atomic
def change_section(
    *,
    enrollment: StudentEnrollment,
    section: Section,
    roll_number: str | None = None,
    capacity_override_reason: str | None = None,
    actor_has_capacity_override: bool = False,
    actor_id: uuid.UUID,
) -> StudentEnrollment:
    """Mid-session reallocation to a different section of the same class."""
    assert_session_writable(enrollment.academic_session)
    assert_section_belongs_to_class(section=section, school_class=enrollment.school_class)
    _assert_capacity(
        section=section,
        exclude_enrollment_id=enrollment.pk,
        capacity_override_reason=capacity_override_reason,
        actor_has_capacity_override=actor_has_capacity_override,
    )

    enrollment.section = section
    # Roll numbers are unique per section; carry the existing value forward
    # when the caller does not supply a new one rather than clearing it —
    # a genuine collision surfaces as the usual IntegrityError-mapped 409.
    if roll_number is not None:
        enrollment.roll_number = roll_number
    enrollment.updated_by = actor_id
    enrollment.save(update_fields=["section", "roll_number", "updated_by", "updated_at"])
    return enrollment


def clearance_blockers(student: Student) -> list[str]:
    """Cross-module clearance checks (module doc §7.2): outstanding fee dues,

    un-returned library books, un-returned transport/asset assignments. None
    of those owning modules exist yet (all later tiers), so this always
    returns no blockers today — a documented gap (plan §19 gap 9), not a
    false "all clear". Extend this list as each owning module ships, in that
    module's own PR.
    """
    return []


@transaction.atomic
def withdraw_student(
    *,
    student: Student,
    reason: str,
    effective_date: date,
    waive_clearance: bool = False,
    actor_has_withdrawal_approval: bool = False,
    actor_id: uuid.UUID,
) -> Student:
    """Withdraw a student (module doc §7.2). A single audited action, not a

    separate initiate/approve workflow — no `student_withdrawals` entity
    exists in any entity doc and §16 exposes exactly one endpoint (plan
    deviation A). Blocked while `clearance_blockers()` is non-empty unless the
    caller both passes `waive_clearance` and holds
    `students.withdrawal.approve`.
    """
    assert_student_active(student)
    blockers = clearance_blockers(student)
    if blockers:
        if not waive_clearance:
            raise DomainRuleViolation({"non_field": f"Cannot withdraw: {'; '.join(blockers)}."})
        if not actor_has_withdrawal_approval:
            raise DomainRuleViolation(
                {
                    "waive_clearance": (
                        "Only a user holding students.withdrawal.approve may waive "
                        "clearance blockers."
                    )
                }
            )

    enrollment = active_enrollment(student)
    if enrollment is not None:
        enrollment.status = EnrollmentStatus.WITHDRAWN
        enrollment.end_date = effective_date
        enrollment.updated_by = actor_id
        enrollment.save(update_fields=["status", "end_date", "updated_by", "updated_at"])

    student.status = StudentStatus.WITHDRAWN
    student.updated_by = actor_id
    student.save(update_fields=["status", "updated_by", "updated_at"])
    return student


def assert_transfer_campus_fields(
    *,
    transfer_type: str,
    from_campus,
    to_campus,
    external_school_name: str | None,
) -> None:
    """Per-type nullability, service-enforced rather than a check constraint

    (plan deviation E) — a 422 naming the field beats an opaque IntegrityError.
    """
    if transfer_type == TransferType.INTER_CAMPUS:
        if from_campus is None or to_campus is None:
            raise DomainRuleViolation(
                {
                    "non_field": (
                        "Inter-campus transfers require both from_campus_id and to_campus_id."
                    )
                }
            )
        if external_school_name:
            raise DomainRuleViolation(
                {"external_school_name": "Not applicable to an inter-campus transfer."}
            )
    elif transfer_type == TransferType.OUTGOING:
        if from_campus is None:
            raise DomainRuleViolation({"from_campus_id": "Required for an outgoing transfer."})
        if to_campus is not None:
            raise DomainRuleViolation({"to_campus_id": "Not applicable to an outgoing transfer."})
        if not external_school_name:
            raise DomainRuleViolation(
                {"external_school_name": "Required for an outgoing transfer."}
            )
    elif transfer_type == TransferType.INCOMING:
        if to_campus is None:
            raise DomainRuleViolation({"to_campus_id": "Required for an incoming transfer."})
        if from_campus is not None:
            raise DomainRuleViolation({"from_campus_id": "Not applicable to an incoming transfer."})
        if not external_school_name:
            raise DomainRuleViolation(
                {"external_school_name": "Required for an incoming transfer."}
            )


@transaction.atomic
def request_transfer(
    *,
    student: Student,
    transfer_type: str,
    reason: str,
    effective_date: date,
    from_campus=None,
    to_campus=None,
    external_school_name: str | None = None,
    actor_id: uuid.UUID,
    tenant_id: uuid.UUID,
) -> StudentTransfer:
    assert_transfer_campus_fields(
        transfer_type=transfer_type,
        from_campus=from_campus,
        to_campus=to_campus,
        external_school_name=external_school_name,
    )
    return StudentTransfer.objects.create(
        tenant_id=tenant_id,
        student=student,
        transfer_type=transfer_type,
        from_campus=from_campus,
        to_campus=to_campus,
        external_school_name=external_school_name,
        reason=reason,
        effective_date=effective_date,
        created_by=actor_id,
        updated_by=actor_id,
    )


def assert_transfer_decidable(*, transfer: StudentTransfer, actor_id: uuid.UUID) -> None:
    if transfer.status != TransferStatus.REQUESTED:
        raise Conflict(f"Transfer is already {transfer.status}.")
    if transfer.created_by == actor_id:
        raise DomainRuleViolation(
            {"non_field": "The initiator of a transfer may not also approve or reject it."}
        )


@transaction.atomic
def approve_transfer(*, transfer: StudentTransfer, actor_id: uuid.UUID) -> StudentTransfer:
    assert_transfer_decidable(transfer=transfer, actor_id=actor_id)
    transfer.status = TransferStatus.APPROVED
    transfer.decided_by = actor_id
    transfer.decided_at = timezone.now()
    transfer.updated_by = actor_id
    transfer.save(update_fields=["status", "decided_by", "decided_at", "updated_by", "updated_at"])
    return transfer


@transaction.atomic
def reject_transfer(*, transfer: StudentTransfer, actor_id: uuid.UUID) -> StudentTransfer:
    assert_transfer_decidable(transfer=transfer, actor_id=actor_id)
    transfer.status = TransferStatus.REJECTED
    transfer.decided_by = actor_id
    transfer.decided_at = timezone.now()
    transfer.updated_by = actor_id
    transfer.save(update_fields=["status", "decided_by", "decided_at", "updated_by", "updated_at"])
    return transfer


@transaction.atomic
def complete_transfer(
    *,
    transfer: StudentTransfer,
    actor_id: uuid.UUID,
    section: Section | None = None,
) -> StudentTransfer:
    """Execute an approved transfer (module doc §6-§7.2).

    Inter-campus: reallocates the student's current enrollment to `section`
    (which must belong to `to_campus`) and moves `student.campus`. Outgoing:
    ends the active enrollment and sets the student's status to
    `transferred`. Incoming has no defined workflow yet (plan drift #2) — this
    is a status-only no-op for that type, documented rather than silently
    guessed at.
    """
    if transfer.status != TransferStatus.APPROVED:
        raise Conflict(
            f"Transfer must be approved before it can be completed (currently {transfer.status})."
        )

    student = transfer.student
    if transfer.transfer_type == TransferType.INTER_CAMPUS:
        if section is None:
            raise DomainRuleViolation(
                {
                    "section_id": (
                        "A destination section is required to complete an inter-campus transfer."
                    )
                }
            )
        if section.campus_id != transfer.to_campus_id:
            raise DomainRuleViolation(
                {"section_id": "Section does not belong to the destination campus."}
            )
        # assert_transfer_campus_fields guarantees to_campus is set for every
        # inter-campus transfer at creation time; this is the type checker's
        # window into that runtime invariant.
        assert transfer.to_campus is not None
        enrollment = active_enrollment(student)
        if enrollment is not None:
            assert_section_belongs_to_class(section=section, school_class=enrollment.school_class)
            _assert_capacity(
                section=section,
                exclude_enrollment_id=enrollment.pk,
                capacity_override_reason=None,
                actor_has_capacity_override=False,
            )
            enrollment.section = section
            enrollment.updated_by = actor_id
            enrollment.save(update_fields=["section", "updated_by", "updated_at"])
        student.campus = transfer.to_campus
        student.updated_by = actor_id
        student.save(update_fields=["campus", "updated_by", "updated_at"])
    elif transfer.transfer_type == TransferType.OUTGOING:
        enrollment = active_enrollment(student)
        if enrollment is not None:
            enrollment.status = EnrollmentStatus.TRANSFERRED_OUT
            enrollment.end_date = transfer.effective_date
            enrollment.updated_by = actor_id
            enrollment.save(update_fields=["status", "end_date", "updated_by", "updated_at"])
        student.status = StudentStatus.TRANSFERRED
        student.updated_by = actor_id
        student.save(update_fields=["status", "updated_by", "updated_at"])
    # incoming: no automated side effect — see the docstring.

    transfer.status = TransferStatus.COMPLETED
    transfer.updated_by = actor_id
    transfer.save(update_fields=["status", "updated_by", "updated_at"])
    return transfer


def build_history(student: Student) -> list[dict]:
    """Assemble the student's timeline from enrollments and transfers (module

    doc §10). Promotions and a curated slice of the audit log are the other
    two sources §10 names — promotions have no producer yet (academics is a
    later tier) and folding in raw audit_log entries needs a curation pass to
    avoid noise, so both are left out here rather than half-built.
    """
    events: list[dict] = []

    enrollments = (
        StudentEnrollment.objects.alive()
        .filter(student=student)
        .select_related("academic_session", "school_class", "section")
    )
    for enrollment in enrollments:
        events.append(
            {
                "type": "enrollment",
                "id": str(enrollment.pk),
                "date": enrollment.enrollment_date.isoformat(),
                "status": enrollment.status,
                "academic_session_id": str(enrollment.academic_session_id),
                "academic_session_name": enrollment.academic_session.name,
                "class_id": str(enrollment.school_class_id),
                "class_name": enrollment.school_class.name,
                "section_id": str(enrollment.section_id),
                "section_name": enrollment.section.name,
                "roll_number": enrollment.roll_number,
            }
        )

    transfers = (
        StudentTransfer.objects.alive()
        .filter(student=student)
        .select_related("from_campus", "to_campus")
    )
    for transfer in transfers:
        events.append(
            {
                "type": "transfer",
                "id": str(transfer.pk),
                "date": transfer.effective_date.isoformat(),
                "status": transfer.status,
                "transfer_type": transfer.transfer_type,
                "from_campus_id": str(transfer.from_campus_id) if transfer.from_campus_id else None,
                "from_campus_name": transfer.from_campus.name if transfer.from_campus else None,
                "to_campus_id": str(transfer.to_campus_id) if transfer.to_campus_id else None,
                "to_campus_name": transfer.to_campus.name if transfer.to_campus else None,
                "external_school_name": transfer.external_school_name,
                "reason": transfer.reason,
            }
        )

    events.sort(key=lambda event: event["date"])
    return events
