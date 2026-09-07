"""Shared document rendering: escape-by-default HTML, and one PDF renderer."""

from core.documents.html import attr, html_table, text
from core.documents.pdf import DEFAULT_ROW_LIMIT, PdfTooLarge, render_pdf

__all__ = [
    "DEFAULT_ROW_LIMIT",
    "PdfTooLarge",
    "attr",
    "html_table",
    "render_pdf",
    "text",
]
