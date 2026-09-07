"""§13's five reports, as pure query functions.

Separate from `services.py` for the reason `attendance.reports` and
`timetable.conflicts` are separate from theirs: this is a self-contained query
engine that two callers use — the synchronous endpoint and the export job — and
mixing it into the write path would put the module's largest reads in its
least-read file.

**No query inside a loop, anywhere in this file.** A result register over a
whole school is exactly the shape `ENGINEERING_STANDARDS.md` §3's N+1 rule
exists for, and every function here is asserted with a query count so a later
refactor that reintroduces one fails rather than merely slows.

**Every function takes an already-scoped queryset rather than building its own.**
§13's closing line is "teachers see assigned sections; students/guardians see
own; leadership sees all", and a report that queried the table directly would
quietly ignore that — the one place record scope is easiest to lose is the place
it matters most, because a report is read as authoritative.

Each returns plain rows — dicts of scalars — so the serializer, the CSV writer
and the PDF renderer all read the same numbers.
"""

from __future__ import annotations

from decimal import Decimal

from django.db.models import Avg, Count, F, Max, Min, Q, QuerySet

from apps.examinations.models import (
    Marks,
    MarksStatus,
    Question,
    QuestionBank,
    Result,
    ResultOutcome,
)

# §13's five rows, plus question-bank usage which §13 pairs with grade
# distribution. Named here because the endpoint validates against it and the
# export job dispatches on it — two places that must agree.
REPORT_KINDS = (
    "result-register",
    "pass-fail-analysis",
    "subject-performance",
    "marks-entry-status",
    "grade-distribution",
    "question-bank-usage",
)

# Outcomes that count as having sat the exam. An absent student is excluded
# from a pass rate rather than counted as a failure — the same reasoning
# `processing` gives for not scoring them zero, applied to the denominator.
SAT_OUTCOMES = frozenset({ResultOutcome.PASS, ResultOutcome.FAIL})


def _capped(rows, limit: int | None):
    """Apply the caller's row cap as a queryset slice.

    A slice, not a Python truncation: the point of the cap is that the rows are
    never built, so it has to reach SQL as a LIMIT. `None` means unbounded,
    which is what the export job asks for.
    """
    return rows if limit is None else rows[:limit]


def _as_dicts(rows) -> list[dict]:
    """`.values()` yields TypedDict rows; every caller here wants plain dicts."""
    return [dict(row) for row in rows]


def _rate(part: int, whole: int) -> Decimal:
    """A percentage to one decimal place; 0 when nothing was counted."""
    if not whole:
        return Decimal("0.0")
    return (Decimal(part) * 100 / Decimal(whole)).quantize(Decimal("0.1"))


def result_register(queryset: QuerySet[Result], *, exam_id, limit: int | None = None) -> list[dict]:
    """§13's result register — one exam, student by student, with rank.

    The document a school prints and files. Ordered by rank rather than by name
    because that is how a register is read, with unranked (absent) students
    last — `F("rank_in_section").asc(nulls_last=True)` rather than a plain sort,
    which would put them first.
    """
    rows = (
        queryset.filter(exam_id=exam_id)
        .select_related("student", "section", "grade_band")
        .order_by(F("rank_in_section").asc(nulls_last=True), "student__last_name")
        .values(
            "id",
            "student_id",
            "percentage",
            "total_obtained_marks",
            "total_max_marks",
            "gpa",
            "rank_in_section",
            "rank_in_class",
            "outcome",
            "status",
            first_name=F("student__first_name"),
            last_name=F("student__last_name"),
            admission_number=F("student__admission_number"),
            section_name=F("section__name"),
            grade=F("grade_band__label"),
        )
    )
    return _as_dicts(_capped(rows, limit))


def pass_fail_analysis(
    queryset: QuerySet[Result], *, exam_id, limit: int | None = None
) -> list[dict]:
    """§13's pass/fail analysis, per section.

    One grouped query. The rate is computed in Python from two counted columns
    rather than in SQL, because the denominator excludes absent and withheld
    students — expressible as a filtered `Count` but far harder to read, and
    this runs once per report rather than once per row.
    """
    grouped = (
        queryset.filter(exam_id=exam_id)
        .values("section_id", section_name=F("section__name"))
        .annotate(
            students=Count("id"),
            sat=Count("id", filter=Q(outcome__in=SAT_OUTCOMES)),
            passed=Count("id", filter=Q(outcome=ResultOutcome.PASS)),
            failed=Count("id", filter=Q(outcome=ResultOutcome.FAIL)),
            absent=Count("id", filter=Q(outcome=ResultOutcome.ABSENT)),
            withheld=Count("id", filter=Q(outcome=ResultOutcome.WITHHELD)),
            average_percentage=Avg("percentage"),
            highest_percentage=Max("percentage"),
            lowest_percentage=Min("percentage"),
        )
        .order_by("section__name")
    )
    return [
        {**row, "pass_rate": _rate(row["passed"], row["sat"])} for row in _capped(grouped, limit)
    ]


def subject_performance(
    queryset: QuerySet[Marks], *, exam_id, limit: int | None = None
) -> list[dict]:
    """§13's subject performance — averages and distribution, per exam-subject.

    Over `marks`, not `results`: a result is an aggregate across subjects, and
    "which paper was hard" is a question about one paper. `is_absent` and
    `is_exempt` rows are excluded from the average rather than counted as zero,
    for the reason `processing` gives — a zero nobody sat is not a low mark.
    """
    grouped = (
        queryset.filter(exam_subject__exam_id=exam_id)
        .exclude(Q(is_absent=True) | Q(is_exempt=True))
        .values(
            "exam_subject_id",
            subject_name=F("exam_subject__subject__name"),
            class_name=F("exam_subject__school_class__name"),
            max_marks=F("exam_subject__max_marks"),
            pass_marks=F("exam_subject__pass_marks"),
        )
        .annotate(
            students=Count("id"),
            average_marks=Avg("theory_marks"),
            highest_marks=Max("theory_marks"),
            lowest_marks=Min("theory_marks"),
            passed=Count("id", filter=Q(theory_marks__gte=F("exam_subject__pass_marks"))),
        )
        .order_by("exam_subject__subject__name")
    )
    return [
        {**row, "pass_rate": _rate(row["passed"], row["students"])}
        for row in _capped(grouped, limit)
    ]


def marks_entry_status(
    queryset: QuerySet[Marks], *, exam_id, limit: int | None = None
) -> list[dict]:
    """§13's marks-entry status — the operational chase list.

    A **report** view of the same question `services.marks_entry_progress`
    answers for §6's dashboard, and the two deliberately differ: the dashboard
    computes an *expected* roll from enrolments so a subject nobody has started
    shows as outstanding, while this counts what exists so it can be exported
    alongside the other reports over one queryset. Where they disagree, the
    dashboard is the one to trust for chasing; this is the one to trust for a
    record of what was entered.
    """
    grouped = (
        queryset.filter(exam_subject__exam_id=exam_id)
        .values(
            "exam_subject_id",
            subject_name=F("exam_subject__subject__name"),
            class_name=F("exam_subject__school_class__name"),
            locked_at=F("exam_subject__marks_locked_at"),
        )
        .annotate(
            entered=Count("id"),
            draft=Count("id", filter=Q(status=MarksStatus.DRAFT)),
            submitted=Count("id", filter=Q(status=MarksStatus.SUBMITTED)),
            locked=Count("id", filter=Q(status=MarksStatus.LOCKED)),
            absent=Count("id", filter=Q(is_absent=True)),
            exempt=Count("id", filter=Q(is_exempt=True)),
        )
        .order_by("exam_subject__subject__name")
    )
    return _as_dicts(_capped(grouped, limit))


def grade_distribution(
    queryset: QuerySet[Result], *, exam_id, limit: int | None = None
) -> list[dict]:
    """§13's grade distribution — band counts per exam.

    Grouped on the band rather than on the percentage, so the histogram matches
    the scale a school published rather than an arbitrary bucketing. A result
    with no band (an absent student) groups under a null label, which the
    formatter renders as "Ungraded" rather than dropping — a distribution that
    silently omits students does not add up to the cohort.
    """
    grouped = (
        queryset.filter(exam_id=exam_id)
        .values(
            "grade_band_id",
            grade=F("grade_band__label"),
            min_percent=F("grade_band__min_percent"),
            max_percent=F("grade_band__max_percent"),
            is_passing=F("grade_band__is_passing"),
        )
        .annotate(students=Count("id"))
        .order_by(F("grade_band__min_percent").desc(nulls_last=True))
    )
    return _as_dicts(_capped(grouped, limit))


def question_bank_usage(
    queryset: QuerySet[QuestionBank], *, limit: int | None = None
) -> list[dict]:
    """§13's question-bank usage — questions by topic and difficulty, and reuse.

    One grouped query over `questions`, joined from the scoped bank queryset so
    §13's role visibility still applies: a teacher sees the banks for subjects
    they teach, which `QuestionBank.filter_assigned_to_user` resolves.
    """
    grouped = (
        Question.objects.alive()
        .filter(question_bank__in=queryset)
        .values(
            "question_bank_id",
            "difficulty",
            bank_name=F("question_bank__name"),
            subject_name=F("question_bank__subject__name"),
        )
        .annotate(
            questions=Count("id"),
            approved=Count("id", filter=Q(is_approved=True)),
            total_uses=Count("id", filter=Q(usage_count__gt=0)),
            average_uses=Avg("usage_count"),
        )
        .order_by("question_bank__name", "difficulty")
    )
    return _as_dicts(_capped(grouped, limit))
