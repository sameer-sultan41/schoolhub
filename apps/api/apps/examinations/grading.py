"""The grading maths, as pure functions.

Separate from `services.py` for the reason `timetable.conflicts` and
`attendance.reports` are separate from theirs: this is a self-contained
computation that three callers use — the scale endpoint that validates a scale
on write, the result-processing job that grades a whole school, and the report
that counts bands — and burying it in the write path would put the module's
most-reviewed arithmetic in its least-read file.

**Nothing here queries.** Every function takes the rows it needs. Result
processing grades every student in a school in one job, and a band lookup that
queried would be exactly the N+1 `ENGINEERING_STANDARDS.md` §3 exists for —
except worse than usual, because the query would be identical every time.
"""

from __future__ import annotations

from decimal import ROUND_HALF_UP, Decimal

from core.api.exceptions import DomainRuleViolation

ZERO = Decimal("0.00")
HUNDRED = Decimal("100.00")
# One decimal place, matching `results.percentage` (NUMERIC(5,2) holds two, but
# a school publishes one) and `attendance.reports._rate`, so the two modules'
# percentages round the same way.
PERCENT_PRECISION = Decimal("0.1")


def percentage_for(obtained: Decimal, maximum: Decimal) -> Decimal:
    """`obtained` as a percentage of `maximum`, to one decimal place.

    A zero maximum returns 0 rather than raising: it means every subject in the
    aggregate was exempt, which is a real state for a student on a reduced
    timetable, and a division error is a worse answer than a zero the caller can
    interpret alongside `outcome`.

    ROUND_HALF_UP, not Python's default banker's rounding: 84.55 becomes 84.6,
    which is what a school and a parent both expect, and a grade boundary
    decided by ROUND_HALF_EVEN is a conversation nobody wants to have.
    """
    if maximum <= 0:
        return ZERO.quantize(PERCENT_PRECISION)
    return (obtained * HUNDRED / maximum).quantize(PERCENT_PRECISION, rounding=ROUND_HALF_UP)


def assert_scale_is_complete(bands: list) -> None:
    """§11 — bands must be contiguous, non-overlapping, and cover 0-100%.

    Checked on the whole set, because a band is only wrong relative to its
    neighbours; see `models.py`'s header for why this cannot be a constraint.

    Called before an exam may reference a scale rather than on every band write,
    so a school can *build* a scale band by band without each intermediate state
    being rejected — and cannot reach result processing with a scale that would
    leave a percentage ungraded. The failure names the exact gap or overlap: an
    error saying only "bands are invalid" leaves an admin to find a 0.01 seam by
    eye across fifteen rows.
    """
    if not bands:
        raise DomainRuleViolation(
            {"bands": "A grading scale needs at least one band before an exam can use it."}
        )

    ordered = sorted(bands, key=lambda band: band.min_percent)

    if ordered[0].min_percent != ZERO:
        raise DomainRuleViolation(
            {
                "bands": (
                    f"The lowest band starts at {ordered[0].min_percent}%, so a result below "
                    "that would have no grade. The scale must start at 0."
                )
            }
        )
    if ordered[-1].max_percent != HUNDRED:
        raise DomainRuleViolation(
            {
                "bands": (
                    f"The highest band ends at {ordered[-1].max_percent}%, so a result above "
                    "that would have no grade. The scale must reach 100."
                )
            }
        )

    for lower, upper in zip(ordered, ordered[1:], strict=False):
        if upper.min_percent <= lower.max_percent:
            raise DomainRuleViolation(
                {
                    "bands": (
                        f"{lower.label} ends at {lower.max_percent}% and {upper.label} starts "
                        f"at {upper.min_percent}%, so they overlap. Bands must not share a "
                        "percentage."
                    )
                }
            )
        # Adjacent bands must meet, and the seam is the *next whole* value at the
        # column's own precision: 0-49.99 then 50-100 is contiguous, 0-49 then
        # 50-100 leaves 49.5 ungraded. Comparing at two decimal places is what
        # `NUMERIC(5,2)` can actually store, so this rejects exactly the gaps
        # that could be hit and no more.
        if upper.min_percent - lower.max_percent > Decimal("0.01"):
            raise DomainRuleViolation(
                {
                    "bands": (
                        f"Nothing grades a result between {lower.max_percent}% and "
                        f"{upper.min_percent}% — {lower.label} and {upper.label} leave a gap."
                    )
                }
            )


def band_for(percentage: Decimal, bands: list):
    """The band covering `percentage`, or None if the scale leaves it ungraded.

    Both ends of a band are inclusive, so a boundary percentage matches two
    adjacent bands. This resolves in favour of the **upper** one: a student on
    exactly 80.0 gets the better grade, which is the reading a school will
    defend to a parent, and it is decided here rather than left to row order.

    Returns None rather than raising for an ungraded percentage.
    `assert_scale_is_complete` is what makes that unreachable for a scale an
    exam is allowed to use; a caller processing results treats None as a data
    problem to report, not as an exception mid-job.
    """
    matches = [band for band in bands if band.min_percent <= percentage <= band.max_percent]
    if not matches:
        return None
    return max(matches, key=lambda band: band.min_percent)


def gpa_for(band, scale) -> Decimal | None:
    """The grade point for a band, or None where the scale has no GPA.

    A `percentage` or `letter` scale returns None even where a band happens to
    carry a `grade_point`: the scale type is what a school published, and
    emitting a GPA it never defined would put a number on a report card that
    nothing backs.
    """
    from apps.examinations.models import GPA_SCALE_TYPES

    if band is None or scale.scale_type not in GPA_SCALE_TYPES:
        return None
    return band.grade_point
