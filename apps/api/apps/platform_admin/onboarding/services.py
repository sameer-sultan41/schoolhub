"""The school's onboarding checklist (platform-admin §5.6, school-organization §7.1).

Each step's progress is computed from the school's own rows, read under the request's tenant
binding (RLS), never stored: a campus deleted after its step was done makes the step undone
again, and the wizard resumes wherever the data says it is. Only what no row records is kept on
`TenantSettings.onboarding`: when the profile was confirmed, which skippable steps were skipped,
and when the checklist was first found complete.

Other apps' models are read here (ADR-0013 allows reads); the session rule reuses
`term_coverage_errors` through school-organization's entry point.
"""

from __future__ import annotations

import uuid
from collections.abc import Callable
from dataclasses import dataclass

from django.db import models
from django.db.models import Func, JSONField, Q, Value
from django.db.models.fields.json import KT
from django.utils import timezone

from apps.fees_finance.models import FeeStructure, FeeStructureStatus
from apps.school_organization.models import (
    AcademicSession,
    Campus,
    Class,
    SessionStatus,
    Subject,
)
from apps.school_organization.services import lock_settings_row, term_coverage_errors
from apps.student_management.models import Student
from core.api.exceptions import DomainRuleViolation
from core.rbac.models import Invitation, InvitationKind
from core.tenancy.features import is_feature_enabled
from core.tenancy.models import Tenant, TenantSettings


class OnboardingStepKey(models.TextChoices):
    """The checklist's steps, in wizard order (fh-constraints' step table)."""

    PROFILE = "profile", "School profile"
    CAMPUSES = "campuses", "Campuses"
    ACADEMIC_SESSION = "academic_session", "Academic session and terms"
    CLASSES = "classes", "Classes and sections"
    SUBJECTS = "subjects", "Subjects"
    FEE_STRUCTURES = "fee_structures", "Fee structures"
    STAFF_INVITES = "staff_invites", "Staff invitations"
    STUDENTS = "students", "Students"
    GO_LIVE = "go_live", "Go live"


# The stored document's keys.
PROFILE_CONFIRMED_AT = "profile_confirmed_at"
SKIPPED = "skipped"
COMPLETED_AT = "completed_at"

# The sessions a school can still go live with (a closed or archived one is history).
LIVE_SESSION_STATES = (SessionStatus.PLANNED, SessionStatus.ACTIVE)


def _campus_count() -> int:
    return Campus.objects.alive().filter(is_active=True).count()


def _session_count() -> int:
    # A school has a handful of sessions, so one coverage check each is a bounded read.
    sessions = AcademicSession.objects.alive().filter(status__in=LIVE_SESSION_STATES)
    return sum(1 for session in sessions if not term_coverage_errors(session))


def _class_count() -> int:
    return (
        Class.objects.alive()
        .filter(is_active=True, sections__deleted_at__isnull=True, sections__is_active=True)
        .distinct()
        .count()
    )


def _subject_count() -> int:
    return Subject.objects.alive().filter(is_active=True).count()


def _fee_structure_count() -> int:
    return FeeStructure.objects.alive().filter(status=FeeStructureStatus.ACTIVE).count()


def _staff_invite_count() -> int:
    # Staff invitations only: the owner's own invitation (`OWNER`) never counts. An accepted
    # one counts; otherwise it must have been sent and be neither revoked nor failed.
    return (
        Invitation.objects.filter(kind=InvitationKind.STAFF)
        .filter(
            Q(accepted_at__isnull=False)
            | Q(sent_at__isnull=False, revoked_at__isnull=True, send_failed_at__isnull=True)
        )
        .count()
    )


def _student_count() -> int:
    return Student.objects.alive().count()


def _profile_confirmed(stored: dict) -> bool:
    return bool(stored.get(PROFILE_CONFIRMED_AT))


def _session_active(_stored: dict) -> bool:
    return AcademicSession.objects.alive().filter(status=SessionStatus.ACTIVE).exists()


@dataclass(frozen=True)
class StepRule:
    """One checklist step.

    A counted step is done once its count is above zero and reports the count; `profile` and
    `go_live` answer yes or no from ``done`` and carry no count.
    """

    key: str
    skippable: bool = False
    module: str | None = None
    count: Callable[[], int] | None = None
    done: Callable[[dict], bool] | None = None


# In wizard order.
STEPS: tuple[StepRule, ...] = (
    StepRule(OnboardingStepKey.PROFILE, done=_profile_confirmed),
    StepRule(OnboardingStepKey.CAMPUSES, count=_campus_count),
    StepRule(OnboardingStepKey.ACADEMIC_SESSION, count=_session_count),
    StepRule(OnboardingStepKey.CLASSES, count=_class_count),
    StepRule(OnboardingStepKey.SUBJECTS, count=_subject_count),
    StepRule(
        OnboardingStepKey.FEE_STRUCTURES,
        skippable=True,
        module="module.fees_finance",
        count=_fee_structure_count,
    ),
    StepRule(
        OnboardingStepKey.STAFF_INVITES,
        skippable=True,
        module="module.staff",
        count=_staff_invite_count,
    ),
    StepRule(
        OnboardingStepKey.STUDENTS, skippable=True, module="module.students", count=_student_count
    ),
    StepRule(OnboardingStepKey.GO_LIVE, done=_session_active),
)
SKIPPABLE_KEYS = frozenset(step.key for step in STEPS if step.skippable)


class _JSONBMerge(Func):
    """`a || b` on two jsonb values: b's top-level keys over a's."""

    arg_joiner = " || "
    template = "(%(expressions)s)"
    output_field = JSONField()


def _stored(tenant: Tenant) -> dict:
    document = (
        TenantSettings.objects.filter(tenant=tenant).values_list("onboarding", flat=True).first()
    )
    return document if isinstance(document, dict) else {}


def _stamp_completed(tenant: Tenant) -> str | None:
    """Stamp `completed_at` once and return the stored stamp.

    A conditional `UPDATE` rather than a read-then-write: two requests that both find the
    checklist complete serialise on the row, and the second's `WHERE` no longer matches once the
    first has committed, so the first stamp is never overwritten.
    """
    stamp = timezone.now().isoformat()
    (
        TenantSettings.objects.filter(tenant=tenant)
        .alias(stamped=KT(f"onboarding__{COMPLETED_AT}"))
        .filter(stamped__isnull=True)
        .update(
            onboarding=_JSONBMerge(
                "onboarding", Value({COMPLETED_AT: stamp}, output_field=JSONField())
            )
        )
    )
    return _stored(tenant).get(COMPLETED_AT)


def _step_state(rule: StepRule, stored: dict, skipped: set[str]) -> dict:
    state: dict = {"key": rule.key, "skippable": rule.skippable, "skipped": rule.key in skipped}
    if rule.count is not None:
        state["count"] = rule.count()
        state["done"] = state["count"] > 0
    else:
        state["done"] = rule.done is not None and rule.done(stored)
    return state


def onboarding_progress(tenant: Tenant) -> dict:
    """The checklist for ``tenant``, which the caller has bound (RLS).

    A step whose module is off for the school is omitted. ``completed`` holds when every step
    left is done or skipped; the first read that finds it so stamps ``completed_at``.
    """
    stored = _stored(tenant)
    skipped = set(stored.get(SKIPPED) or [])
    steps = [
        _step_state(rule, stored, skipped)
        for rule in STEPS
        if rule.module is None or is_feature_enabled(rule.module, tenant_id=tenant.pk)
    ]
    completed = all(step["done"] or step["skipped"] for step in steps)
    completed_at = stored.get(COMPLETED_AT)
    if completed and completed_at is None:
        completed_at = _stamp_completed(tenant)
    return {"steps": steps, "completed": completed, "completed_at": completed_at}


def update_onboarding(
    *,
    tenant: Tenant,
    actor_id: uuid.UUID,
    confirm: str | None = None,
    skip: str | None = None,
    unskip: str | None = None,
) -> tuple[TenantSettings, dict, dict]:
    """Confirm the profile, or skip or unskip a skippable step: one action per call.

    Runs under the settings row lock and merges into the stored document, so it never drops a
    key another writer (or the `completed_at` stamp) put there. Returns the row and the document
    before and after, for the audit.
    """
    if confirm is not None and confirm != OnboardingStepKey.PROFILE:
        raise DomainRuleViolation({"confirm": "Only the profile step is confirmed by hand."})
    for field, key in (("skip", skip), ("unskip", unskip)):
        if key is not None and key not in SKIPPABLE_KEYS:
            raise DomainRuleViolation({field: f"The '{key}' step cannot be skipped."})

    row = lock_settings_row(tenant_id=tenant.pk, actor_id=actor_id)
    before = dict(row.onboarding or {})
    document = dict(before)
    skipped = list(document.get(SKIPPED) or [])
    if confirm is not None and not document.get(PROFILE_CONFIRMED_AT):
        document[PROFILE_CONFIRMED_AT] = timezone.now().isoformat()
    if skip is not None and skip not in skipped:
        skipped.append(skip)
    if unskip is not None and unskip in skipped:
        skipped.remove(unskip)
    document[SKIPPED] = skipped

    row.onboarding = document
    row.updated_by = actor_id
    row.save(update_fields=["onboarding", "updated_by", "updated_at"])
    return row, before, document
