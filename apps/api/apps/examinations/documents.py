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
