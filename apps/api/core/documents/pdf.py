"""The one place this platform turns HTML into a PDF.

Three modules render documents — student ID cards, attendance report exports,
and examinations' admit cards, report cards and exam papers — and before this
file each of them imported WeasyPrint and built its own template. That is a
maintenance cost, but the reason it became one file is narrower than that: two
of the three escaped their inputs and one did not, and the one that did not was
printing children's names.

**The import stays inside the function.** WeasyPrint links against system
libraries (pango, cairo, gdk-pixbuf) that only ``.github/workflows/api.yml``'s
``test`` job installs, so a module-level import breaks ``manage.py`` everywhere
else — including ``check --deploy``, which CI runs. Every caller in this repo
already followed that convention; centralising it means one place has to
remember rather than four.
"""

from __future__ import annotations

# A page of A4 at the font sizes used here holds roughly 45 table rows, so this
# is about 45 pages. Past that a PDF is a document nobody opens and a render
# slow enough to hold a Celery worker — the caller is told, rather than handed a
# truncated file that looks complete.
DEFAULT_ROW_LIMIT = 2000


class PdfTooLarge(Exception):
    """Raised when a document is too long to honestly render as a PDF."""


def render_pdf(html: str, *, page_size: str = "A4") -> bytes:
    """Render a complete HTML document to PDF bytes.

    `html` must already be escaped — build it with `core.documents.html`, which
    is escape-by-default for exactly this reason. Nothing here can tell a
    deliberate ``<b>`` from a student surname that happens to contain one.

    `page_size` is passed through to an ``@page`` rule only when the caller has
    not written its own; a document that sets its own margins and orientation
    (a landscape register, a portrait report card) is left alone.
    """
    from weasyprint import HTML

    if "@page" not in html:
        html = html.replace("<head>", f"<head><style>@page {{ size: {page_size}; }}</style>", 1)
    return HTML(string=html).write_pdf()
