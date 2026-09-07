"""Escape-by-default helpers for building the HTML a PDF is rendered from.

There is no ``raw()`` here, and that omission is the point. Every PDF this
platform produces interpolates data a person typed — a student's name, a
teacher's remark, a school's address — and the failure mode of getting it wrong
is not a security abstraction: ``apps/student_management``'s ID-card renderer
f-string'd names straight into its template, so a pupil legitimately recorded as
``O'Brien & Sons`` rendered a broken card, and one whose name contained a tag
rewrote it. A caller that genuinely needs markup composes it from ``text()``-
escaped parts, which makes the escaping visible in the diff rather than absent
from it.

The module is deliberately tiny and has no Django imports: it is called from
Celery tasks, from services, and from tests, and a helper that needs an
application registry to escape a string would be a helper nobody reaches for.
"""

from __future__ import annotations

import datetime
from html import escape


def text(value: object) -> str:
    """One value, escaped and ready to sit between two tags.

    ``None`` becomes an empty string rather than the word "None": a nullable
    column with no value is a blank cell on a printed card, and "None" printed
    on a child's report card is a defect a parent will photograph.

    Dates and times are ISO. A locale-formatted date inside a document that a
    second system may later parse is the classic way a column of dates becomes a
    column of text, and the same reasoning ``core.exports.tabular`` already
    applies to spreadsheet cells applies here.
    """
    if value is None:
        return ""
    if isinstance(value, datetime.date | datetime.time):
        return escape(value.isoformat())
    return escape(str(value))


def attr(value: object) -> str:
    """One value, escaped for use inside a double-quoted HTML attribute.

    Separate from `text` because `html.escape`'s ``quote`` argument is the
    difference between the two, and a caller choosing a boolean flag at each
    call site is a caller who will eventually choose the wrong one.
    """
    if value is None:
        return ""
    return escape(str(value), quote=True)


def html_table(rows: list[dict], *, headers: list[str] | None = None) -> str:
    """A ``<table>`` over uniform row dicts, every cell and heading escaped.

    Column order comes from the first row when `headers` is not given: report
    rows come from one ``.values()`` call, so the keys are uniform and
    insertion-ordered — the order the query author wrote them in, which is the
    order a reader expects rather than an alphabetical scramble.

    An empty result renders a one-cell table saying so. A zero-row table and a
    failed render look identical on paper otherwise, and "the report is broken"
    is a far more expensive conclusion than "nothing matched".
    """
    if not rows:
        return (
            "<table><thead><tr><th>Result</th></tr></thead>"
            "<tbody><tr><td>no rows matched</td></tr></tbody></table>"
        )

    columns = headers if headers is not None else list(rows[0])
    head = "".join(f"<th>{text(column)}</th>" for column in columns)
    body = "".join(
        "<tr>" + "".join(f"<td>{text(row.get(column))}</td>" for column in columns) + "</tr>"
        for row in rows
    )
    return f"<table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table>"
