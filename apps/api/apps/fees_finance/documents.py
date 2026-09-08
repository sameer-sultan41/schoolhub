"""Receipt and voucher documents, in both the layouts §10 requires.

§10 asks for receipts and vouchers "in both A4/letter PDF and 80mm thermal
layouts, generated from the same template data so content never diverges
between the two". That sentence is the whole design here: one builder per
document produces the *content*, and the layout is a stylesheet plus a page
size. A second builder per format is how a receipt's total ends up printed
correctly on one and wrongly on the other.

Everything interpolated goes through `core.documents.html.text`, which escapes.
That is not defensive habit — a school's name, a student's name and a fee head's
description are all tenant-controlled strings reaching a rendered document, and
the ID-card renderer that f-string'd a student's name straight into HTML is the
reason `core/documents` exists at all.

`render_pdf` already threads `page_size`, so thermal needs no core change:
`80mm auto` is a real WeasyPrint page size and the stylesheet narrows the type
scale to match.
"""

from __future__ import annotations

from core.documents import html, render_pdf

A4 = "A4"
THERMAL = "80mm auto"

_SHARED_CSS = """
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; color: #111; }
  h1 { margin: 0 0 2mm; }
  .muted { color: #555; }
  table { width: 100%; border-collapse: collapse; margin-top: 3mm; }
  th, td { text-align: left; padding: 1mm 0; }
  td.amount, th.amount { text-align: right; }
  .total { border-top: 1px solid #111; font-weight: 600; }
"""

_A4_CSS = """
  @page { size: A4; margin: 18mm; }
  body { font-size: 11pt; }
  h1 { font-size: 18pt; }
"""

# 80mm thermal: no margins to speak of, and a type scale that survives a
# receipt printer's resolution. `auto` height is what makes the roll cut at the
# end of the content rather than at a page boundary.
_THERMAL_CSS = """
  @page { size: 80mm auto; margin: 3mm; }
  body { font-size: 9pt; }
  h1 { font-size: 12pt; }
  table { font-size: 9pt; }
"""


def _document(*, title: str, body: str, page_size: str) -> str:
    layout = _THERMAL_CSS if page_size == THERMAL else _A4_CSS
    return (
        "<!doctype html><html><head><meta charset='utf-8'>"
        f"<title>{html.text(title)}</title>"
        f"<style>{_SHARED_CSS}{layout}</style>"
        f"</head><body>{body}</body></html>"
    )


def _rows(pairs: list[tuple[str, object]]) -> str:
    return "".join(
        f"<tr><td>{html.text(label)}</td><td class='amount'>{html.text(value)}</td></tr>"
        for label, value in pairs
    )


def receipt_html(*, receipt, payment, invoice, student, school_name: str, page_size: str) -> str:
    """One receipt, in whichever layout the caller asked for.

    The figures come from the receipt and payment rows rather than being
    recomputed: a receipt is a document handed over at a moment in time, and
    `receipts.amount` is a snapshot for exactly that reason.
    """
    lines = _rows(
        [
            ("Receipt no", receipt.receipt_no),
            ("Date", receipt.issued_at.date()),
            ("Student", f"{student.first_name} {student.last_name}".strip()),
            ("Admission no", student.admission_number),
            ("Invoice", invoice.invoice_no),
            ("Method", payment.get_method_display()),
            ("Reference", payment.reference_no or "—"),
        ]
    )
    body = (
        f"<h1>{html.text(school_name)}</h1>"
        f"<p class='muted'>Fee receipt</p>"
        f"<table>{lines}"
        f"<tr class='total'><td>Amount received</td>"
        f"<td class='amount'>{html.text(receipt.amount)}</td></tr>"
        f"<tr><td>Balance remaining</td>"
        f"<td class='amount'>{html.text(invoice.balance_due)}</td></tr>"
        f"</table>"
    )
    return _document(title=f"Receipt {receipt.receipt_no}", body=body, page_size=page_size)


def voucher_html(*, voucher, invoice, student, school_name: str, page_size: str) -> str:
    """One payment voucher, carrying the consumer number a bank keys on.

    The consumer number is rendered prominently and on its own line because it
    is the only field a bank teller actually types. Everything else on the slip
    is for the family.
    """
    lines = _rows(
        [
            ("Provider", voucher.get_provider_display()),
            ("Student", f"{student.first_name} {student.last_name}".strip()),
            ("Admission no", student.admission_number),
            ("Invoice", invoice.invoice_no),
            ("Pay by", voucher.due_date),
        ]
    )
    body = (
        f"<h1>{html.text(school_name)}</h1>"
        f"<p class='muted'>Fee payment voucher</p>"
        f"<p><strong>Consumer number</strong><br>"
        f"<span style='font-size:1.4em;letter-spacing:0.08em'>"
        f"{html.text(voucher.consumer_number)}</span></p>"
        f"<table>{lines}"
        f"<tr class='total'><td>Amount payable</td>"
        f"<td class='amount'>{html.text(voucher.amount)}</td></tr>"
        f"</table>"
        f"<p class='muted'>This voucher is void after the date shown. "
        f"A replacement can be issued from the parent portal.</p>"
    )
    return _document(title=f"Voucher {voucher.consumer_number}", body=body, page_size=page_size)


def render_receipt(*, page_size: str = A4, **kwargs) -> bytes:
    """Render a receipt. `page_size` selects the stylesheet, not `render_pdf`'s
    fallback — these templates write their own `@page`, which `render_pdf`
    deliberately leaves alone."""
    return render_pdf(receipt_html(page_size=page_size, **kwargs))


def render_voucher(*, page_size: str = A4, **kwargs) -> bytes:
    return render_pdf(voucher_html(page_size=page_size, **kwargs))
