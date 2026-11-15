"""AI-FEE-02: a plain-language summary of one finance report (fees-finance.md §14).

Registered with the gateway (``core.ai``) when the app loads. This module owns what
the feature may send to the provider (ai-governance.md §1.1-§1.2):

- ``CONTEXT_ALLOWLIST`` names, per report kind, every fact key and table column that
  may enter a prompt. Anything else a caller hands over is dropped, so a column added
  to a report later stays out of the prompt until someone adds it here, in review.
- No name, admission number, user id, expense number, description, vendor, discount,
  scholarship or budget name, or row id is ever allowlisted. A cashier appears as
  ``Cashier-N`` and a budget as ``Budget-N``; the gateway restores both after the
  answer is validated, and the map never leaves the backend.
- Ledger-account and expense-category names are school-typed text, so they are
  allowed but fenced inside ``<report_data>`` as untrusted (§3.4), with angle
  brackets and line breaks neutralised.
- ``student-ledger`` is refused outright: it is one family's statement.

Every figure reaches the model as a named fact, and the model must cite it as
``{{fact:key}}`` (``core.ai.grounding``), so no number in a summary is the model's own.
"""

from __future__ import annotations

import datetime
import heapq
from dataclasses import dataclass, field
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any

from apps.fees_finance import reports
from core.ai import grounding
from core.ai.evals import EvalCase, EvalSuite, eval_suites
from core.ai.grounding import GroundingContext
from core.ai.redaction import Pseudonymizer
from core.ai.registry import AIFeature, registry

FEATURE_KEY = "fees.report-summary"
FEATURE_FLAG = "ai.fee-report-summary"
PROMPT_VERSION = "fees.report-summary@1"
PROMPT_PATH = Path(__file__).parent / "prompts" / "report_summary_v1.txt"

#: The table a prompt carries is cut to this many rows; the facts always span every row.
MAX_TABLE_ROWS = 50

#: Kinds no summary is offered for. A student ledger is one family's statement.
REFUSED_KINDS = frozenset({"student-ledger"})

#: Facts every kind carries.
_COMMON = frozenset({"period_start", "period_end", "row_count", "rows_shown"})

#: Every fact key and table column each kind may put in a prompt (ai-governance.md §1.1).
CONTEXT_ALLOWLIST: dict[str, frozenset[str]] = {
    "collection": _COMMON
    | {"total_collected", "payment_count", "day", "method", "cashier", "total", "count"},
    "outstanding-aging": _COMMON
    | {
        "total_outstanding",
        "invoice_count",
        "student_count",
        "not_yet_due",
        "overdue_0_30",
        "overdue_31_60",
        "overdue_61_90",
        "overdue_90_plus",
    },
    "grant-register": _COMMON
    | {
        "discount_count",
        "scholarship_count",
        "fine_waiver_count",
        "fine_waived_total",
        "kind",
        "status",
        "count",
    },
    "income-vs-expense": _COMMON
    | {"total_income", "total_expense", "net_result", "account", "account_type", "net"},
    "budget-variance": _COMMON
    | {
        "budget_count",
        "total_budgeted",
        "total_actual",
        "total_variance",
        "over_budget_count",
        "budget",
        "period_start",
        "period_end",
        "budgeted",
        "actual",
        "variance",
        "utilisation_percent",
    },
    "expense-register": _COMMON
    | {"expense_count", "total_amount", "total_tax", "category", "status", "count", "total", "tax"},
    "trial-balance": _COMMON
    | {
        "total_debit",
        "total_credit",
        "difference",
        "account",
        "account_type",
        "debit",
        "credit",
        "balance",
    },
}

#: Table columns that are labels (shown as text), not figures (cited as facts).
LABEL_COLUMNS = frozenset(
    {"method", "cashier", "kind", "status", "account", "account_type", "budget", "category"}
)

#: §13's aging bucket names, quotable as written.
AGING_LABELS = frozenset(label for label, _ in reports.AGING_BUCKETS)

KIND_TITLES = {
    "collection": "Fee collection",
    "outstanding-aging": "Outstanding balances and aging",
    "grant-register": "Discounts, scholarships and fine waivers",
    "income-vs-expense": "Income and expense",
    "budget-variance": "Budget against actual",
    "expense-register": "Expenses",
    "trial-balance": "Trial balance",
}


@dataclass
class SummaryFacts:
    """What one report contributes to a summary.

    ``facts`` are the headline figures over the whole scoped set; ``table`` holds at
    most ``MAX_TABLE_ROWS`` rows. ``input_ref`` is a hash of both, for the audit row.
    """

    facts: dict[str, str]
    table: list[dict[str, str]]
    input_ref: str
    is_empty: bool = False
    pseudonymizer: Pseudonymizer = field(default_factory=Pseudonymizer)


@dataclass(frozen=True)
class SummaryContext:
    user_prompt: str
    grounding: GroundingContext


def _neutralise(value: str) -> str:
    """Record text cannot close the fence or start a new line of instructions."""
    cleaned = " ".join(value.split()).replace("<", "‹").replace(">", "›").replace('"', "'")
    return cleaned.replace("{{", "{ {").replace("}}", "} }")[:80]


def _years(facts: dict[str, str]) -> frozenset[str]:
    """The years the period covers, quotable as written ("in 2026")."""
    try:
        start = datetime.date.fromisoformat(facts["period_start"]).year
        end = datetime.date.fromisoformat(facts["period_end"]).year
    except KeyError, ValueError:
        return frozenset()
    if end - start > 10:
        return frozenset()
    return frozenset(str(year) for year in range(start, end + 1))


def _size(value: str) -> Decimal:
    """A row's magnitude for downsampling: the number in a money string, else 0."""
    digits = "".join(ch for ch in value if ch.isdigit() or ch in ".-")
    try:
        return abs(Decimal(digits))
    except InvalidOperation:
        return Decimal(0)


def downsample(rows: list[dict[str, str]], *, size_key: str) -> list[dict[str, str]]:
    """At most ``MAX_TABLE_ROWS`` rows, in their original order: the first, the last,
    and the largest by ``size_key`` in between."""
    if len(rows) <= MAX_TABLE_ROWS:
        return rows
    middle = range(1, len(rows) - 1)
    largest = heapq.nlargest(MAX_TABLE_ROWS - 2, middle, key=lambda i: _size(rows[i][size_key]))
    keep = sorted({0, len(rows) - 1, *largest})
    return [rows[i] for i in keep]


def build_summary_context(*, kind: str, summary: SummaryFacts) -> SummaryContext:
    """The prompt and grounding for one report, keeping only what the allowlist names."""
    allowed = CONTEXT_ALLOWLIST[kind]
    facts = {key: value for key, value in summary.facts.items() if key in allowed}
    labels: set[str] = set(_years(facts))
    if kind == "outstanding-aging":
        labels |= AGING_LABELS

    row_lines: list[str] = []
    for number, row in enumerate(summary.table, start=1):
        parts: list[str] = []
        for column in sorted(row):
            if column not in allowed:
                continue
            if column in LABEL_COLUMNS:
                # Account and category names are text a school typed: neutralised, only
                # ever inside the fence, and never a source of quotable digits (only
                # aliases, bucket names and the period's years are).
                parts.append(f'{column} "{_neutralise(row[column])}"')
            else:
                key = f"row_{number}_{column}"
                facts[key] = row[column]
                parts.append(f"{column} {{{{fact:{key}}}}}")
        row_lines.append(f"- row {number}: " + "; ".join(parts))

    fact_lines = [f"- {key} = {value}" for key, value in sorted(facts.items())]
    body = [
        f"report: {KIND_TITLES[kind]}",
        "facts (cite each as {{fact:<key>}}):",
        *fact_lines,
    ]
    if row_lines:
        body += ["rows:", *row_lines]
    prompt = "\n".join(
        [
            "Summarise this finance report for the school's staff.",
            "<report_data>",
            *body,
            "</report_data>",
        ]
    )
    return SummaryContext(
        user_prompt=prompt,
        grounding=GroundingContext(
            facts=facts, allowed_labels=frozenset(labels) | summary.pseudonymizer.aliases
        ),
    )


registry.register(
    AIFeature(
        key=FEATURE_KEY,
        flag_key=FEATURE_FLAG,
        tier="fast",
        prompt_version=PROMPT_VERSION,
        system_prompt=PROMPT_PATH.read_text(encoding="utf-8"),
        max_output_tokens=600,
        validate_output=grounding.check,
    )
)


# --------------------------------------------------------------------- evals

EVALS_DIR = Path(__file__).parent / "tests" / "evals"


def build_eval_case(case: dict[str, Any]) -> EvalCase:
    """A golden case (JSON, no database) as the exact prompt the live feature would send."""
    names = Pseudonymizer()
    table = [dict(row) for row in case.get("table", [])]
    for row in table:
        # Golden cases name cashiers and budgets as people do; the alias is what is sent.
        if "cashier" in row:
            row["cashier"] = names.alias("Cashier", row["cashier"])
        if "budget" in row:
            row["budget"] = names.alias("Budget", row["budget"])
    summary = SummaryFacts(
        facts=dict(case["facts"]),
        table=table,
        input_ref=f"eval:{case['id']}",
        pseudonymizer=names,
    )
    context = build_summary_context(kind=case["kind"], summary=summary)
    return EvalCase(
        id=case["id"],
        user_prompt=context.user_prompt,
        grounding=context.grounding,
        forbidden=tuple(case.get("forbidden", [])),
        adversarial=bool(case.get("adversarial", False)),
    )


eval_suites.register(
    EvalSuite(
        feature_key=FEATURE_KEY,
        golden_path=EVALS_DIR / "report_summary_golden.json",
        baseline_path=EVALS_DIR / "baseline.json",
        build_case=build_eval_case,
    )
)
