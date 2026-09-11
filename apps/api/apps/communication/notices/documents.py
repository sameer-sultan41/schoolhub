"""Notice documents — A4 only.

A notice has no thermal-printer use case the way a receipt or voucher does
(§10 asks for those in both layouts; notices are not mentioned), so this
module ships one layout, not two. Everything interpolated goes through
`core.documents.html.text`, which escapes — a notice's title and body are
tenant-authored text reaching a rendered document.
"""

from __future__ import annotations

from core.documents import html, render_pdf

A4 = "A4"

_CSS = """
  @page { size: A4; margin: 20mm; }
  body {
    font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
    color: #111;
    font-size: 11pt;
  }
  h1 { font-size: 16pt; margin: 0 0 2mm; }
  .muted { color: #555; margin: 0 0 6mm; }
  .body { white-space: pre-wrap; line-height: 1.5; }
"""


def notice_html(*, notice, school_name: str) -> str:
    """One notice, rendered as a formal document.

    `notice.body` is free text the drafter wrote in the composer; it is not
    HTML and is not trusted, so it goes through `html.text` like every other
    tenant-authored string here rather than being inserted verbatim.
    """
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>{html.text(notice.title)}</title>"
        f"<style>{_CSS}</style>"
        "</head><body>"
        f"<h1>{html.text(school_name)}</h1>"
        f"<p class='muted'>Notice {html.text(notice.notice_no or '')} &middot; "
        f"{html.text(notice.get_notice_type_display())}</p>"
        f"<h2>{html.text(notice.title)}</h2>"
        f"<div class='body'>{html.text(notice.body)}</div>"
        "</body></html>"
    )


def render_notice(*, notice, school_name: str) -> bytes:
    return render_pdf(notice_html(notice=notice, school_name=school_name), page_size=A4)
