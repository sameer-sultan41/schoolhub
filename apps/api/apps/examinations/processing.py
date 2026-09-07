"""§5.5's result processing, as a bounded set of queries over pre-fetched rows.

Separate from `services.py` for the reason `conflicts.py` and `grading.py` are:
this is the module's most-reviewed arithmetic and its heaviest read, and two
callers reach it — the 202 job and the recompute a rejected exam triggers.

**Nothing in the per-student loop queries.** A result run grades every student
in a school at once, so the obvious implementation — for each student, fetch
their marks and look up a band — is two round trips per child. `collect()`
fetches everything in a fixed number of queries and the computation below is
pure. `ENGINEERING_STANDARDS.md` §3's N+1 rule is the general statement; here it
is also the difference between a job that finishes and one that times out on a
2,000-student school.

**Three rules in here are the ones a school will argue about**, so each is named
and tested rather than left implicit:

- An **absent** student is `outcome=absent`, not a zero. A zero would put them
  bottom of the rank and count against the section's pass rate.
- An **exempt** subject leaves the denominator smaller rather than scoring
  zero: §5.4 calls exemption "excluded from aggregates".
- **Ranks are dense and ties share a rank.** Two students on 91.0% are both
  second, and the next is third. The alternative — breaking ties by name or id —
  invents a difference the marks do not support.
"""

from __future__ import annotations

import uuid
from collections import defaultdict
from dataclasses import dataclass, field
from decimal import Decimal

from apps.examinations import grading
from apps.examinations.models import (
    Exam,
    ExamSubject,
    GradeBand,
    Marks,
    MarksStatus,
    Result,
    ResultOutcome,
    ResultStatus,
)
from core.api.exceptions import Conflict

ZERO = Decimal("0.00")

# Marks that count as a real, finished entry. A `draft` row was saved but never
# claimed as finished, and processing it would grade a student on a
# half-entered grid — which is why `:lock-marks` stamps rows as well as closing
# the window.
COUNTABLE_MARK_STATUSES = frozenset({MarksStatus.SUBMITTED, MarksStatus.LOCKED})

# The columns a recompute overwrites. Named once, because `bulk_update` needs
# the list explicitly and deriving it from the last loop iteration's dict — the
# first thing I wrote — breaks silently when `computed` is empty.
RESULT_COMPUTED_FIELDS = (
    "section",
    "total_max_marks",
    "total_obtained_marks",
    "percentage",
    "grade_band",
    "gpa",
    "rank_in_section",
    "rank_in_class",
    "outcome",
    "status",
    "updated_by",
)


@dataclass
class StudentTotals:
    """One student's aggregate, before it becomes a `Result` row."""

    obtained: Decimal = ZERO
    maximum: Decimal = ZERO
    sat_any: bool = False
    absent_all: bool = True
    failed_a_subject: bool = False


@dataclass
class Scope:
    """Everything processing reads, fetched once."""

    exam: Exam | None = None
    exam_subjects: list = field(default_factory=list)
    marks: list = field(default_factory=list)
    bands: list = field(default_factory=list)
    student_section: dict = field(default_factory=dict)
    student_class: dict = field(default_factory=dict)
    expected_by_subject: dict = field(default_factory=dict)


def collect(*, exam: Exam) -> Scope:
    """Fetch every row processing needs — five queries, whatever the size.

    The enrolment map is what pins each result's `section_id` at processing
    time. Read here rather than per student for the usual reason, and stored on
    the result rather than resolved again later so a mid-year section change
    cannot retroactively move a published result into another section's ranks.
    """
    from apps.student_management.models import EnrollmentStatus, StudentEnrollment

    exam_subjects = list(ExamSubject.objects.alive().filter(exam=exam).select_related("subject"))
    marks = list(
        Marks.objects.alive()
        .filter(exam_subject__exam=exam, status__in=COUNTABLE_MARK_STATUSES)
        .values(
            "student_id",
            "exam_subject_id",
            "theory_marks",
            "practical_marks",
            "is_absent",
            "is_exempt",
        )
    )
    bands = list(GradeBand.objects.alive().filter(grading_scale=exam.grading_scale))

    enrollments = list(
        StudentEnrollment.objects.alive()
        .filter(
            academic_session_id=exam.academic_session_id,
            status=EnrollmentStatus.ACTIVE,
            school_class_id__in={subject.school_class_id for subject in exam_subjects},
        )
        .values_list("student_id", "section_id", "school_class_id")
    )

    expected_by_subject: dict = defaultdict(set)
    student_section = {}
    student_class = {}
    by_class: dict = defaultdict(set)
    for student_id, section_id, class_id in enrollments:
        student_section[student_id] = section_id
        student_class[student_id] = class_id
        by_class[class_id].add(student_id)
    for subject in exam_subjects:
        expected_by_subject[subject.pk] = by_class[subject.school_class_id]

    return Scope(
        exam=exam,
        exam_subjects=exam_subjects,
        marks=marks,
        bands=bands,
        student_section=student_section,
        student_class=student_class,
        expected_by_subject=dict(expected_by_subject),
    )


def assert_ready_to_process(scope: Scope) -> None:
    """§11 — processing is blocked while any exam-subject has marks outstanding.

    Measured against the *expected roll* per exam-subject, not against rows that
    happen to exist: a subject nobody has started has no rows at all, and
    counting only what is present would let it pass as complete.

    §11 also names an "override with an audited waiver" — a **recommendation**,
    and not built. It would need a permission key §4 does not declare, and a
    waiver is only meaningful once a school has met the block often enough to
    say what should bypass it. Recorded in the module doc's §20 register.
    """
    if not scope.exam_subjects:
        raise Conflict("This exam has no subjects configured, so there is nothing to process.")

    entered_by_subject: dict = defaultdict(set)
    for row in scope.marks:
        entered_by_subject[row["exam_subject_id"]].add(row["student_id"])

    outstanding = []
    for subject in scope.exam_subjects:
        expected = scope.expected_by_subject.get(subject.pk, set())
        missing = expected - entered_by_subject.get(subject.pk, set())
        if missing:
            outstanding.append(f"{subject.subject.name} ({len(missing)} student(s))")

    if outstanding:
        raise Conflict(
            "Marks are still outstanding, so results cannot be processed: "
            + "; ".join(sorted(outstanding))
            + "."
        )


def _weighted(value: Decimal, weight: Decimal) -> Decimal:
    """Apply an exam-subject's weightage, as a proportion of 100.

    §5.1 makes `subject_weightage_percent` a weight *within* the exam's
    aggregate, so a subject at 50% contributes half its marks and half its
    maximum — which keeps the percentage a percentage. Scaling only the obtained
    side would silently change what the total was out of.
    """
    return (value * weight / Decimal("100")).quantize(Decimal("0.01"))


def compute(scope: Scope) -> list[dict]:
    """Every student's aggregate, grade and rank — no queries, no ordering luck.

    Returns plain dicts, so the caller writes them and `reports.py` can read the
    same numbers without this function knowing about either.
    """
    subjects_by_id = {subject.pk: subject for subject in scope.exam_subjects}
    totals: dict = defaultdict(StudentTotals)

    for row in scope.marks:
        subject = subjects_by_id.get(row["exam_subject_id"])
        if subject is None:
            continue
        entry = totals[row["student_id"]]

        if row["is_exempt"]:
            # §5.4 — "excluded from aggregates". Neither side of the fraction
            # moves, which is what makes an exemption different from a zero.
            entry.absent_all = False
            continue

        weight = subject.subject_weightage_percent
        subject_max = subject.max_marks + (subject.practical_max_marks or ZERO)
        entry.maximum += _weighted(subject_max, weight)

        if row["is_absent"]:
            # The maximum still counts — the paper was set and not sat — but
            # nothing is obtained, and the student is not marked as having sat.
            continue

        entry.absent_all = False
        entry.sat_any = True
        theory = row["theory_marks"] or ZERO
        practical = row["practical_marks"] or ZERO
        entry.obtained += _weighted(theory + practical, weight)

        if theory < subject.pass_marks:
            entry.failed_a_subject = True
        if (
            subject.has_practical
            and subject.practical_pass_marks is not None
            and practical < subject.practical_pass_marks
        ):
            entry.failed_a_subject = True

    computed = []
    for student_id, entry in totals.items():
        percentage = grading.percentage_for(entry.obtained, entry.maximum)
        band = grading.band_for(percentage, scope.bands)
        if entry.absent_all or not entry.sat_any:
            outcome = ResultOutcome.ABSENT
        elif entry.failed_a_subject or (band is not None and not band.is_passing):
            outcome = ResultOutcome.FAIL
        else:
            outcome = ResultOutcome.PASS

        computed.append(
            {
                "student_id": student_id,
                "section_id": scope.student_section.get(student_id),
                "class_id": scope.student_class.get(student_id),
                "total_max_marks": entry.maximum,
                "total_obtained_marks": entry.obtained,
                "percentage": percentage,
                "grade_band": band,
                "gpa": grading.gpa_for(band, scope.exam.grading_scale)
                if scope.exam is not None
                else None,
                "outcome": outcome,
            }
        )

    _rank(computed, key="section_id", into="rank_in_section")
    _rank(computed, key="class_id", into="rank_in_class")
    return computed


def _rank(computed: list[dict], *, key: str, into: str) -> None:
    """Dense ranks within each group, ties sharing a rank.

    Two students on 91.0% are both second and the next is third. Breaking the
    tie by name or id would invent a difference the marks do not support, and a
    school publishing that has to defend it.

    **Absent students are not ranked.** They have no percentage to place, and
    ranking them last would read as a position rather than an absence.
    """
    grouped: dict = defaultdict(list)
    for row in computed:
        if row["outcome"] == ResultOutcome.ABSENT or row[key] is None:
            row[into] = None
            continue
        grouped[row[key]].append(row)

    for rows in grouped.values():
        ordered = sorted(rows, key=lambda row: row["percentage"], reverse=True)
        rank = 0
        previous = None
        for position, row in enumerate(ordered, start=1):
            if row["percentage"] != previous:
                rank = position
                previous = row["percentage"]
            row[into] = rank


def write(*, exam: Exam, computed: list[dict], actor_id: uuid.UUID) -> dict:
    """Upsert every computed row. Two queries for the whole school.

    Upsert, because §6 makes recompute idempotent and re-runnable — a second run
    updates in place rather than colliding with
    `results_one_per_student_per_exam`.

    `bulk_update` rather than a save per row: a 2,000-student school is 2,000
    round trips otherwise, and that is the shape this whole module is written
    to avoid.
    """
    existing = {row.student_id: row for row in Result.objects.alive().filter(exam=exam)}

    to_create = []
    to_update = []
    for row in computed:
        current = existing.get(row["student_id"])
        # A **withheld** result stays withheld through a recompute. §5.6 makes
        # withholding a per-student decision someone took; silently returning it
        # to `pass`/`fail` because the numbers were recalculated would reverse
        # that decision without anyone asking — the same reasoning that keeps a
        # revoked admit card revoked through a re-issue.
        withheld = current is not None and current.outcome == ResultOutcome.WITHHELD
        values = {
            "section_id": row["section_id"],
            "total_max_marks": row["total_max_marks"],
            "total_obtained_marks": row["total_obtained_marks"],
            "percentage": row["percentage"],
            "grade_band": row["grade_band"],
            "gpa": row["gpa"],
            "rank_in_section": row["rank_in_section"],
            "rank_in_class": row["rank_in_class"],
            "outcome": ResultOutcome.WITHHELD if withheld else row["outcome"],
            "status": ResultStatus.PENDING_APPROVAL,
            "updated_by": actor_id,
        }
        if current is None:
            to_create.append(
                Result(
                    tenant=exam.tenant,
                    exam=exam,
                    student_id=row["student_id"],
                    created_by=actor_id,
                    **values,
                )
            )
        else:
            for attribute, value in values.items():
                setattr(current, attribute, value)
            to_update.append(current)

    if to_create:
        Result.objects.bulk_create(to_create)
    if to_update:
        Result.objects.bulk_update(to_update, RESULT_COMPUTED_FIELDS, batch_size=500)

    return {"created": len(to_create), "updated": len(to_update)}
