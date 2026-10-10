# 0023. Every bulk importer reads its file through one shared parser in `core/imports/`

- **Status:** Accepted
- **Date:** 2026-10-10
- **Enforced by:** `apps/api/core/imports/tests/test_tabular.py` (the parser's behaviour) and mypy's `disallow_untyped_defs` ratchet on `core.imports.*` (`apps/api/pyproject.toml`); that a fifth importer reuses it is review only

## Context

Four importers take "a spreadsheet a school already has": students, staff, attendance registers and
exam marks (`docs/superpowers/plans/2026-10-10-students-phase4-bulk-operations.md`). They read the
file with a parser that began in `student_management`, was copied into `staff_management`, and was
imported cross-app by `attendance` and `examinations`. Only the staff copy tracked real row numbers;
none handled Excel date cells, an xlsx file's missing or wrong size record, a misspelled required
header or a non-UTF-8 file. Four callers is past the rule of three — the details that are silently
wrong in a reimplementation (the BOM, openpyxl's read-only flags, row-number drift after a blank
line) belong in one place.

## Decision

`apps/api/core/imports/tabular.py` owns file parsing. `parse_rows(filename=, data=, required_columns=)`
returns `list[dict[str, str]]` keyed by the file's whitespace-stripped header names, plus one reserved
key, `ROW_NUMBER_KEY`, carrying the row's real line or sheet row. A short xlsx row is padded with `""`,
as `csv.DictReader` pads a short CSV row. A missing `required_columns` header, a non-UTF-8 CSV or a
corrupt workbook raises `ImportFileError`, whose `str()` is a user-facing sentence, before any row is
imported. Each importer's own row function and column constants stay in its own app.

## Alternatives considered

- **A `ParsedRow` dataclass instead of a dict** — why not: it ripples into all four importers' row
  functions for no behavioural gain; the dict plus one reserved key is what they already read.
- **Keep the parser in `student_management`** — why not: a generic file concern would stay inside one
  module's services, with other apps coupled to `student_management` just to read a spreadsheet.
- **Reject a short xlsx row as a per-row error (the staff copy's behaviour)** — why not: it is
  inconsistent with CSV, which pads, and it breaks on xlsx files whose size record is missing or wrong.

## Consequences

- Attendance and exams error reports now carry real row numbers instead of `index + 1`, which drifted
  after a blank row.
- A misspelled or missing required header fails the whole job with one readable error, not one error
  per row. That holds for the student and staff importers, which pass `required_columns`; attendance
  and exam marks do not yet, so a misspelled header there still yields one error per row
  ([`deferred-work.md`](../deferred-work.md)).
- A new importer calls `parse_rows` and reads `row[ROW_NUMBER_KEY]`; it does not parse files itself.
- Known exception: `apps/api/apps/fees_finance/adapters/generic_csv.py` (payment-provider settlement
  files) keeps its own reader. Case-insensitive headers, and whole-file problems reported as row 0
  into the reconciliation exceptions queue, are a different contract. Its row numbers still drift
  after a blank line ([`deferred-work.md`](../deferred-work.md)).
