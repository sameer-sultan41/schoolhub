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

from apps.student_management.models import Student
from core.api.exceptions import DomainRuleViolation
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

    Exact match for PR1; the module doc §6 fuzzy name+DOB+guardian-phone match
    upgrades this once `guardians` exists (a later PR) — conservative defaults
    per §19's recommendation on tenant-tunable thresholds.
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
    photo_file_id: uuid.UUID | None = None,
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
        photo_file_id=photo_file_id,
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
