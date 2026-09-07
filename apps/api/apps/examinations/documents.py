"""HTML for this module's printed documents, over `core.documents`.

Kept separate from `tasks.py` for the reason `attendance.exports` is separate
from its own: the layout of a document a school hands to a child is reviewed by
different eyes than the job that renders it, and mixing the two puts the
markup in the least-read file.

**Every interpolated value goes through `core.documents.html`,** which is
escape-by-default and has no `raw()` to reach for. These are student names and
teacher-written instructions, and the ID-card renderer this module's PDF work
replaced is the reason that matters: it f-string'd names into a template, so a
pupil recorded as `O'Brien & Sons` produced a broken card.
"""

from __future__ import annotations

from core.documents import html

# Portrait, and one card per page. A card is carried into a hall and checked at
# a desk, so it is a single sheet by design rather than a sheet-per-cohort:
# `admit_cards` is one row per student and the file is one student's document.
_STYLES = """
@page { size: A4; margin: 16mm; }
body { font-family: sans-serif; font-size: 11pt; color: #111; }
h1 { font-size: 16pt; margin: 0 0 1mm; }
.school { color: #444; font-size: 10pt; margin: 0 0 6mm; }
.identity { border: 0.6pt solid #666; padding: 4mm; margin-bottom: 6mm; }
.identity dt { float: left; width: 42mm; font-weight: bold; }
.identity dd { margin: 0 0 1.5mm 42mm; }
.number { font-variant-numeric: tabular-nums; letter-spacing: 0.5pt; }
table { border-collapse: collapse; width: 100%; }
th, td { border: 0.4pt solid #999; padding: 1.6mm 2mm; text-align: left; }
thead { display: table-header-group; }
.instructions { margin-top: 6mm; font-size: 9.5pt; color: #333; }
.signature { margin-top: 14mm; font-size: 9.5pt; }
"""


def admit_card_html(*, card, exam, student, sittings, school_name: str) -> str:
    """One student's admit card: identity block, sitting table, instructions.

    `sittings` comes from `services.student_sittings` already ordered and with
    its subject and room selected, so nothing here queries — the same rule
    `conflicts.py` states for its detectors, applied to a renderer that runs
    once per student in a batch of hundreds.

    Per-sitting `instructions` are collected and printed once at the foot rather
    than repeated in every row: they are usually identical across an exam, and a
    table with the same paragraph in every cell is a card nobody reads.
    """
    rows = "".join(
        "<tr>"
        f"<td>{html.text(sitting.exam_subject.subject.name)}</td>"
        f"<td>{html.text(sitting.exam_date)}</td>"
        f"<td>{html.text(sitting.start_time)} - {html.text(sitting.end_time)}</td>"
        f"<td>{html.text(sitting.room.code if sitting.room else '—')}</td>"
        "</tr>"
        for sitting in sittings
    )
    if not rows:
        # A card with no sittings is a real state — a section scheduled after
        # the batch ran — and says so rather than printing an empty grid that
        # reads as a rendering fault.
        rows = '<tr><td colspan="4">No papers scheduled for this student yet.</td></tr>'

    notes = []
    for sitting in sittings:
        if sitting.instructions and sitting.instructions not in notes:
            notes.append(sitting.instructions)
    instructions = "".join(f"<p>{html.text(note)}</p>" for note in notes)

    return f"""<html>
  <head>
    <meta charset="utf-8" />
    <title>Admit card {html.text(card.admit_card_no)}</title>
    <style>{_STYLES}</style>
  </head>
  <body>
    <h1>Admit card</h1>
    <p class="school">{html.text(school_name)} &middot; {html.text(exam.name)}</p>
    <dl class="identity">
      <dt>Name</dt>
      <dd>{html.text(f"{student.first_name} {student.last_name}")}</dd>
      <dt>Admission number</dt>
      <dd class="number">{html.text(student.admission_number)}</dd>
      <dt>Admit card number</dt>
      <dd class="number">{html.text(card.admit_card_no)}</dd>
    </dl>
    <table>
      <thead>
        <tr><th>Subject</th><th>Date</th><th>Time</th><th>Room</th></tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
    <div class="instructions">{instructions}</div>
    <p class="signature">Invigilator signature: ______________________</p>
  </body>
</html>"""


_REPORT_CARD_STYLES = """
@page { size: A4; margin: 14mm; }
body { font-family: sans-serif; font-size: 10.5pt; color: #111; }
h1 { font-size: 17pt; margin: 0 0 1mm; }
.school { color: #444; font-size: 10pt; margin: 0 0 6mm; }
.identity dt { float: left; width: 40mm; font-weight: bold; }
.identity dd { margin: 0 0 1.5mm 40mm; }
.identity { border: 0.6pt solid #666; padding: 4mm; margin-bottom: 5mm; }
table { border-collapse: collapse; width: 100%; margin-bottom: 5mm; }
th, td { border: 0.4pt solid #999; padding: 1.6mm 2mm; text-align: left; }
thead { display: table-header-group; }
.numeric { text-align: right; font-variant-numeric: tabular-nums; }
.summary td { border: none; padding: 0.8mm 0; }
.summary .label { font-weight: bold; width: 46mm; }
.remarks { border: 0.4pt solid #999; padding: 3mm; margin-bottom: 4mm; }
.remarks h2 { font-size: 11pt; margin: 0 0 1.5mm; }
.signature { margin-top: 12mm; font-size: 9.5pt; }
.absent { color: #555; font-style: italic; }
"""


def report_card_html(*, card, exam, student, result, subject_rows, school_name: str) -> str:
    """One student's report card — §5.7.

    `subject_rows` and the attendance summary are both passed in already
    resolved, so nothing here queries: a generation batch renders a whole
    section, and a query in this function would be one per child.

    **An absent subject prints "Absent", not a zero**, for the same reason
    `processing` gives the outcome its own value: a zero on a report card reads
    as a mark the student earned.

    Remarks render only when written. An empty "Class teacher's remarks" box on
    a document a parent keeps is worse than no box at all.
    """
    rows = "".join(
        "<tr>"
        f"<td>{html.text(row['subject'])}</td>"
        f'<td class="numeric">{html.text(row["max_marks"])}</td>'
        + (
            '<td class="absent" colspan="2">Absent</td>'
            if row["is_absent"]
            else '<td class="absent" colspan="2">Exempt</td>'
            if row["is_exempt"]
            else f'<td class="numeric">{html.text(row["obtained"])}</td>'
            f"<td>{html.text(row['verdict'])}</td>"
        )
        + "</tr>"
        for row in subject_rows
    )
    if not rows:
        rows = '<tr><td colspan="4">No subject marks recorded.</td></tr>'

    attendance = card.attendance_summary or {}
    attendance_line = (
        f"{html.text(attendance.get('attendance_rate'))}% "
        f"({html.text(attendance.get('present_days'))} of "
        f"{html.text(attendance.get('counted_days'))} days)"
        if attendance
        else '<span class="absent">Not recorded</span>'
    )

    remark_blocks = ""
    for heading, body in (
        ("Class teacher's remarks", card.class_teacher_remarks),
        ("Principal's remarks", card.principal_remarks),
    ):
        if body:
            remark_blocks += (
                f'<div class="remarks"><h2>{html.text(heading)}</h2><p>{html.text(body)}</p></div>'
            )

    rank = (
        html.text(result.rank_in_section)
        if result.rank_in_section is not None
        else '<span class="absent">n/a</span>'
    )
    grade = (
        html.text(result.grade_band.label)
        if result.grade_band_id is not None
        else '<span class="absent">n/a</span>'
    )

    return f"""<html>
  <head>
    <meta charset="utf-8" />
    <title>Report card {html.text(student.admission_number)}</title>
    <style>{_REPORT_CARD_STYLES}</style>
  </head>
  <body>
    <h1>Report card</h1>
    <p class="school">{html.text(school_name)} &middot; {html.text(exam.name)}</p>
    <dl class="identity">
      <dt>Name</dt>
      <dd>{html.text(f"{student.first_name} {student.last_name}")}</dd>
      <dt>Admission number</dt>
      <dd>{html.text(student.admission_number)}</dd>
      <dt>Version</dt>
      <dd>{html.text(card.version)}</dd>
    </dl>
    <table>
      <thead>
        <tr><th>Subject</th><th>Out of</th><th>Obtained</th><th>Result</th></tr>
      </thead>
      <tbody>{rows}</tbody>
    </table>
    <table class="summary">
      <tr><td class="label">Total</td>
          <td>{html.text(result.total_obtained_marks)} /
              {html.text(result.total_max_marks)}</td></tr>
      <tr><td class="label">Percentage</td>
          <td>{html.text(result.percentage)}%</td></tr>
      <tr><td class="label">Grade</td><td>{grade}</td></tr>
      <tr><td class="label">Rank in section</td><td>{rank}</td></tr>
      <tr><td class="label">Outcome</td>
          <td>{html.text(result.get_outcome_display())}</td></tr>
      <tr><td class="label">Attendance</td><td>{attendance_line}</td></tr>
    </table>
    {remark_blocks}
    <p class="signature">Class teacher: ____________________ &nbsp;&nbsp;
       Principal: ____________________</p>
  </body>
</html>"""


_PAPER_STYLES = """
@page { size: A4; margin: 18mm; }
body { font-family: serif; font-size: 11.5pt; color: #000; line-height: 1.45; }
h1 { font-size: 16pt; text-align: center; margin: 0 0 1mm; }
.meta { text-align: center; font-size: 10pt; color: #333; margin: 0 0 3mm; }
.rubric { border: 0.6pt solid #000; padding: 3mm; font-size: 10pt; margin-bottom: 6mm; }
h2 { font-size: 12.5pt; margin: 6mm 0 2mm; border-bottom: 0.4pt solid #666; }
ol { padding-left: 8mm; }
li { margin-bottom: 3.5mm; page-break-inside: avoid; }
.marks { float: right; font-size: 10pt; color: #333; }
.options { list-style-type: lower-alpha; margin: 1.5mm 0 0 0; padding-left: 7mm; }
.options li { margin-bottom: 1mm; }
"""


def exam_paper_html(*, bank, sections, title: str, total_marks, school_name: str) -> str:
    """An assembled exam paper — §5.8, §7.2's final step.

    `sections` is what `services.select_paper_questions` returned: already
    chosen, ordered and de-duplicated, so nothing here queries or decides.

    **MCQ options render as a list; every other type renders as a stem with
    space beneath.** A short-answer question printed with lettered choices under
    it is a paper that confuses a hall of students, and `options` is null for
    those types by design — so the branch is on the data rather than on a flag
    somebody has to set.
    """
    body = ""
    for section in sections:
        body += f"<h2>{html.text(section['title'])}</h2><ol>"
        for question in section["questions"]:
            marks = section.get("marks_each") or question.default_marks
            body += (
                f'<li><span class="marks">[{html.text(marks)}]</span>'
                f"{html.text(question.question_text)}"
            )
            options = question.options if isinstance(question.options, list) else None
            if options:
                body += '<ol class="options">'
                body += "".join(f"<li>{html.text(option)}</li>" for option in options)
                body += "</ol>"
            body += "</li>"
        body += "</ol>"

    if not body:
        # A paper with no questions is a blueprint that matched nothing. The
        # service refuses that before it gets here, so this is a belt-and-braces
        # message rather than an expected state.
        body = "<p>No questions were selected for this paper.</p>"

    return f"""<html>
  <head>
    <meta charset="utf-8" />
    <title>{html.text(title)}</title>
    <style>{_PAPER_STYLES}</style>
  </head>
  <body>
    <h1>{html.text(title)}</h1>
    <p class="meta">{html.text(school_name)} &middot;
       {html.text(bank.subject.name)} &middot;
       Total marks: {html.text(total_marks)}</p>
    <div class="rubric">
      Answer all questions. Marks for each question are shown in brackets.
    </div>
    {body}
  </body>
</html>"""
