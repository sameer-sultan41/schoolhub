# Students Dashboard Phase 4: Bulk Import, Export & ID Cards Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **This repo never runs tests, lint or typecheck locally — not even during TDD.** Every task still writes its test before its implementation, but "verify it fails / passes" means reading the test against the code, then CI at the push checkpoints named below. Never a local `manage.py test`/`jest`/`playwright`/`tsc`/`eslint`/`ruff`.

**Work tier:** 2

**Goal:** Finish `student-management`'s dashboard. This is the last phase of the Phase 1 Roadmap. Admins get bulk student import (CSV/.xlsx with a per-row error report), a full-roster CSV export, and batch ID-card PDF generation from the directory selection. Along the way it fixes the import/export defects this UI would put in front of users.

**Architecture:** The backend endpoints already exist (`POST /student-imports`, `POST /student-exports`, `POST /id-cards:generate`, all `202 + job`).
- **Backend:** Phase 4 consolidates the bulk-import file parser into `core/imports/` (today it is copied twice and imported cross-app by attendance and examinations), fixes per-row validation in the student importer, and neutralises CSV formula injection in both roster exports. The API contract does not change.
- **Dashboard:** the inline staff import dialog and export/poll/download flow become three shared pieces: `BulkImportDialog`, `useJobFileDownload` and `downloadFile`. `/staff` migrates onto them, and `/students` builds Import, Export and ID cards on the same pieces.

**Tech Stack:**
- Backend: Django 6.1 + DRF, openpyxl, Celery (eager in tests).
- Dashboard: Next.js 16, TanStack Query/Table, next-intl, sonner.
- Tests: Jest + RTL, Playwright (mocked `dashboard` project).

**Spec:**
- `docs/03-modules/student-management.md`: §4 permissions, §6 implementation note, §8 migration journey, §16 endpoints, §20 phases.
- The Phase 1 plan's Roadmap, `docs/superpowers/plans/2026-09-30-students-dashboard-phase-1.md`, "Phase 4 — Bulk operations":
  > Import mirrors `/staff`'s `StaffImportDialog`. Required columns … show as a fixed reference table, no column-mapping UI exists server-side. Export mirrors `/staff`'s toolbar flow. ID cards: `POST /id-cards:generate`, a batch action alongside bulk withdraw. Final mobile/RTL audit.

## Context

`docs/project-status.md` says "**Start here next**: Phase 4 (bulk import/export/ID cards) — the only phase left in the original Roadmap." All of the backend shipped in student-management PR 4. None of the dashboard did.

Exploration of `origin/main` (`d9c77b2`) surfaced the following.

**Backend import bugs** (`apps/api/apps/student_management/services.py:972-1114`):
- `gender` is never checked against `Gender`, and the column has no DB check constraint, so an invalid value persists.
- A bad `admission_date` is reported as `date_of_birth`.
- Row numbers come from list position, so they drift after a skipped blank row.
- `Campus.objects.get(code=…)` matches soft-deleted campuses and crashes on `MultipleObjectsReturned`.
- Excel date cells arrive as `"2015-06-01 00:00:00"` and fail `fromisoformat`.
- An xlsx row shorter than the header raises `IndexError`, and an over-length value raises an uncaught `DataError`. Either one fails the whole job.
- The staff copy (`staff/services/import_staff.py`) already fixed drift, short rows and the soft-deleted campus. Attendance and examinations import the student parser cross-app (`attendance/services.py:1409`, `examinations/services.py:1030`). That makes four users of one parser, past the rule of three in `docs/02-architecture/repo-structure.md` §5, which names "the staff and student import … pipelines" as known debt.

**Export:** `build_student_export_csv`/`build_staff_export_csv` write names raw into the CSV. This is the formula-injection gap recorded in `docs/deferred-work.md` ("CSV formula injection in staff/student exports"). `core/exports/tabular.py:96` already has the mitigation, as the private `_spreadsheet_safe`.

**Dashboard:**
- `features/staff/staff-import-dialog.tsx` (322 lines) and `staff-toolbar.tsx`'s export flow (lines 96-177) are the only implementations of these flows.
- The anchor-click download is copied in `staff-toolbar.tsx:147` and `student-documents-tab.tsx:142`.
- Students already has its i18n stubs (`students.import.*`, `students.idCards.*`) and a selection column labelled with `idCards.selectAll`/`selectRow`.

**User decisions (2026-10-10):**
- Extract the shared UI and migrate `/staff` onto it in this PR.
- Fix the student import bugs and the export formula injection on both rosters.

## Alternatives considered (why not)

- **Copy `StaffImportDialog` into `features/students`.** Rejected (user choice). It would be the second copy of a 322-line component, and the third copy of the download snippet.
- **Extract shared pieces and leave `/staff` on its own copy.** Rejected (user choice). It still leaves two copies until a follow-up lands.
- **Keep the parser in `student_management/services.py` and only patch it.** Rejected. Four apps parse with it, and `core/` is where backend sharing goes (repo-structure §5). A fix there would also leave staff's private copy diverging.
- **Return a `ParsedRow` dataclass from the shared parser instead of a reserved `__row_number__` key.** Rejected. The reserved key is staff's existing convention, and attendance/examinations index rows by column name only (verified: no `row.items()`/key iteration). A dataclass would ripple through four importers and their tests for no behavioural gain. The key is exported as a named constant. This is recorded as ADR-0023 (Task 1).
- **Reject xlsx rows shorter than the header (staff's current `__parse_error__`).** Rejected (review finding 2). CSV pads short rows (`restval`). openpyxl's read-only mode trusts the file's size record, so a missing record makes every row with blank trailing optional cells "short". Attendance and exams never checked the key either. Padding plus `reset_dimensions()` is the openpyxl-documented fix.
- **Server-side template download (`GET /student-imports/template`).** Not built. The roadmap fixes the reference to a table of column names, and a new endpoint means an OpenAPI change for a static header row. It is recorded in `deferred-work.md`.
- **ID cards for "everything matching the current filter" rather than the selected rows.** Not built. The endpoint takes `student_ids` only. Filter-wide generation needs a backend change, and the roadmap says "a batch action alongside bulk withdraw", which is selection-based.
- **Make `useJobPolling`'s 120 s cap configurable for big ID-card batches.** Not built. A stalled job already turns the button into "Check status", which resumes polling the same job (staff's existing semantics). A longer cap only delays the same affordance.

## Global Constraints

- **CI is the only verifier.** No local test/lint/typecheck runs. Push, then `gh pr checks <n> --watch`, and `gh run view <id> --log-failed` on a failure. Re-run an env-flaky job with `gh run rerun <id> --failed` before touching code.
- **Commit and push only after the user's explicit go-ahead** at each checkpoint. Never `--no-verify`/`SKIP_HOOKS=1`.
- **Commit format.** Conventional Commits (`type(scope): summary`). Every `fix` commit carries a `Root cause:` line (ADR-0016). No `Co-Authored-By` and no AI attribution in commits or the PR.
- **API contract.** No serializer, view or URL changes are planned, so `apps/api/openapi.yaml`/`schema.d.ts` stay untouched. If any task does touch the contract, regenerate both in the same commit (ADR-0005).
- **Backend sharing goes through `core/`.** `core/` imports no app (`apps/api/tests/test_import_boundaries.py`).
- **Dashboard wiring.**
  - Paths live only in `src/services/endpoints.ts`.
  - Components call `Services.<domain>.*` only.
  - `@schoolhub/api-client` is imported only under `src/services/**`/`src/lib/**`.
  - Wire types come from `ApiSchemas[...]` (ADR-0017).
- **i18n.** Every new string goes in both `apps/dashboard/messages/en.json` and `ur.json`; parity is compile-checked by `src/i18n/messages.types-check.ts`. No hardcoded English in new components.
- **Styling.** Colours use theme tokens only, never arbitrary-value colour utilities (root `CLAUDE.md`).
- **Tests.** Tests live in sibling `__tests__/` folders. The dashboard coverage floor is 85% global, so every new file ships with its test.
- **Docs.** `docs/project-status.md`, the module doc §20, `deferred-work.md` and repo-structure §5 change in this same PR.
- **Graph.** Run `graphify update .` after code changes (`CLAUDE.md`).

## Review Focus

1. **An Excel-authored file with real date cells.** Dates typed in Excel arrive from openpyxl as `datetime`. They must import as `YYYY-MM-DD`, not fail every row. *(Task 1 test `test_xlsx_date_cells_become_iso_dates`.)*
2. **A legacy CSV saved as Windows-1252 ("CSV", not "CSV UTF-8").** The job must fail with a sentence telling the user how to re-save, not a `'utf-8' codec can't decode` traceback string. *(Task 1 test `test_non_utf8_csv_raises_a_readable_error`.)*
3. **A file with a blank line in the middle.** The error table's "Row" must match the row number the spreadsheet shows. *(Task 1 test `test_csv_row_numbers_survive_a_blank_line`; Task 2 API test `test_row_numbers_match_the_file_after_a_blank_line`.)*
4. **Clicking Export or Generate ID cards again while a job is stalled after a timeout.** This must resume watching the same job, never start a second one. *(Task 5 hook test `run() resumes a stalled job instead of starting another`.)*
5. **Selecting rows, starting ID-card generation, then paging away.** The selection the button counts drops to zero, but the button must stay visible, showing progress, until the PDF downloads. *(Task 9 test `stays visible while generating after the selection empties`.)*

Also watch these behaviour changes, which are intended but visible to users:
- **Attendance and exam import error reports change row numbers.** They now match the file. *(Task 1 attendance test.)*
- **An exported name starting with `= + - @` gains a leading apostrophe.** The apostrophe is hidden in spreadsheets but visible in a text editor. *(Task 3 tests.)*
- **The mobile import drawer hides its close control while an upload is in flight.** *(Task 4 drawer-branch test.)*
- **A short xlsx row now imports with blank trailing cells instead of being rejected.** This applies to `/staff` too; the CSV path has always done this.

---

### Task 0: Branch and record the plan

**Files:**
- Create: `docs/superpowers/plans/2026-10-10-students-phase4-bulk-operations.md`, a copy of this file including its `## Independent review` block.

- [ ] **Step 1:** Update local `main`, which is 129 commits behind, then branch:
  ```bash
  git checkout main && git pull --ff-only
  git checkout -b feat/students-phase4-bulk-ops
  ```
- [ ] **Step 2:** Copy this plan to `docs/superpowers/plans/2026-10-10-students-phase4-bulk-operations.md`. CI's `plan-review-record` job requires the `## Independent review` block in any dated plan from 2026-09-26 onward.
- [ ] **Step 3 (after go-ahead):** `git add docs/superpowers/plans/2026-10-10-students-phase4-bulk-operations.md && git commit -m "docs(plans): students phase 4 bulk operations plan"`

---

### Task 1: Backend — shared bulk-import parser in `core/imports/`

**Files:**
- Create: `apps/api/core/imports/__init__.py` (empty docstring module), `apps/api/core/imports/tabular.py`
- Create: `apps/api/core/imports/tests/__init__.py`, `apps/api/core/imports/tests/test_tabular.py`
- Modify:
  - `apps/api/apps/student_management/services.py`: delete `parse_import_rows`, `_parse_import_csv`, `_parse_import_xlsx` (lines ~997-1036).
  - `apps/api/apps/student_management/tasks.py:22-60`
  - `apps/api/apps/staff_management/staff/services/import_staff.py`: delete its `parse_import_rows`/`_parse_import_csv`/`_parse_import_xlsx`; read the constants in `import_staff_row`.
  - `apps/api/apps/staff_management/tasks.py:22-45`
  - `apps/api/apps/attendance/services.py:1401-1411` and `apps/api/apps/attendance/tasks.py:325-339`
  - `apps/api/apps/examinations/services.py:1021-1032` and `apps/api/apps/examinations/tasks.py:334-355`

**Interfaces:**
- Produces:
  - `core.imports.tabular.parse_rows(*, filename: str, data: bytes, required_columns: Sequence[str] = ()) -> list[dict[str, str]]`.
    - Each dict is keyed by header name (whitespace-stripped) and also carries `ROW_NUMBER_KEY`.
    - A short xlsx row is padded with `""`, matching `csv.DictReader`'s `restval`.
    - It raises `ImportFileError` before reading any row if a `required_columns` header is absent.
  - `ROW_NUMBER_KEY = "__row_number__"`. No `PARSE_ERROR_KEY`: padding replaces staff's reject-short-rows behaviour (review finding 2).
  - `class ImportFileError(ValueError)`: its `str()` is a user-facing sentence.

Also add to this task:
- **Files:** Create `docs/decisions/0023-shared-bulk-import-parser.md`, plus an index row in `docs/decisions/README.md`. Modify `apps/api/pyproject.toml` to add `"core.imports.*"` to the `disallow_untyped_defs` module list (line ~102). Test `apps/api/apps/attendance/tests/test_exports_and_import.py`.
- **The ADR:** Context (four importers, one parser, rule of three). Decision: `core/imports/tabular.py` returns `list[dict[str, str]]` plus one reserved `ROW_NUMBER_KEY`, and pads short rows. Alternatives: a `ParsedRow` dataclass (rejected, it ripples into four importers for no behavioural gain), keeping the parser in `student_management` (rejected, cross-app coupling), and rejecting short rows (rejected, it is inconsistent with CSV and breaks on xlsx files with a missing or wrong size record). Consequences: attendance and exams get real row numbers; a misspelled required header fails the whole job with one readable error.

- [ ] **Step 1: Write the failing tests.** `core/imports/tests/test_tabular.py`:

```python
"""core.imports.tabular — the one bulk-import file parser every importer shares."""

from __future__ import annotations

import datetime
import io

import openpyxl
from django.test import SimpleTestCase

from core.imports.tabular import ROW_NUMBER_KEY, ImportFileError, _xlsx_row, parse_rows


def _xlsx(rows: list[list[object]]) -> bytes:
    workbook = openpyxl.Workbook()
    sheet = workbook.active
    for row in rows:
        sheet.append(row)
    buffer = io.BytesIO()
    workbook.save(buffer)
    return buffer.getvalue()


class ParseCsvTests(SimpleTestCase):
    def test_strips_a_utf8_bom_from_the_first_header(self) -> None:
        rows = parse_rows(filename="s.csv", data="﻿first_name\nAmina\n".encode())
        self.assertEqual(rows[0]["first_name"], "Amina")

    def test_csv_row_numbers_survive_a_blank_line(self) -> None:
        rows = parse_rows(filename="s.csv", data=b"first_name\nAmina\n\nBilal\n")
        self.assertEqual([r[ROW_NUMBER_KEY] for r in rows], ["2", "4"])

    def test_non_utf8_csv_raises_a_readable_error(self) -> None:
        with self.assertRaisesMessage(ImportFileError, "CSV UTF-8"):
            parse_rows(filename="s.csv", data="first_name\nZoë\n".encode("cp1252"))

    def test_header_names_are_whitespace_stripped(self) -> None:
        rows = parse_rows(filename="s.csv", data=b" first_name ,last_name\nAmina,Khan\n")
        self.assertEqual(rows[0]["first_name"], "Amina")

    def test_a_missing_required_header_fails_before_any_row(self) -> None:
        with self.assertRaisesMessage(ImportFileError, "first_name"):
            parse_rows(
                filename="s.csv",
                data=b"First Name,last_name\nAmina,Khan\n",
                required_columns=("first_name", "last_name"),
            )

    def test_an_empty_file_with_required_columns_is_a_readable_error(self) -> None:
        with self.assertRaisesMessage(ImportFileError, "header"):
            parse_rows(filename="s.csv", data=b"", required_columns=("first_name",))


class ParseXlsxTests(SimpleTestCase):
    def test_xlsx_date_cells_become_iso_dates(self) -> None:
        data = _xlsx([["first_name", "date_of_birth"], ["Amina", datetime.date(2015, 6, 1)]])
        rows = parse_rows(filename="s.xlsx", data=data)
        self.assertEqual(rows[0]["date_of_birth"], "2015-06-01")

    def test_xlsx_row_numbers_skip_blank_rows_without_drifting(self) -> None:
        data = _xlsx([["first_name"], ["Amina"], [None], ["Bilal"]])
        rows = parse_rows(filename="S.XLSX", data=data)
        self.assertEqual([r[ROW_NUMBER_KEY] for r in rows], ["2", "4"])

    def test_an_empty_workbook_has_no_rows(self) -> None:
        self.assertEqual(parse_rows(filename="s.xlsx", data=_xlsx([])), [])

    def test_a_short_row_is_padded_like_csv_restval(self) -> None:
        row = _xlsx_row(["first_name", "last_name"], ("Amina",), sheet_row=3)
        self.assertEqual(row, {"first_name": "Amina", "last_name": "", ROW_NUMBER_KEY: "3"})

    def test_a_missing_required_header_in_xlsx_is_a_readable_error(self) -> None:
        data = _xlsx([["first_name"], ["Amina"]])
        with self.assertRaisesMessage(ImportFileError, "last_name"):
            parse_rows(filename="s.xlsx", data=data, required_columns=("first_name", "last_name"))

    def test_a_corrupt_workbook_raises_a_readable_error(self) -> None:
        with self.assertRaisesMessage(ImportFileError, ".xlsx"):
            parse_rows(filename="s.xlsx", data=b"not a zip")
```

- [ ] **Step 2: Check the tests fail.** Read them against the tree. `core.imports` does not exist yet, so they fail at import.

- [ ] **Step 3: Implement `core/imports/tabular.py`.** It is staff's parser lifted verbatim, plus `_cell_text`, the empty-sheet guard and `ImportFileError`:

```python
"""Reading an uploaded bulk-import file (CSV or .xlsx) into row dicts.

The one parser every importer shares — students, staff, attendance registers and
exam marks all take "a spreadsheet a school already has" — so the details that are
silently wrong in a reimplementation live once: the BOM Excel's "CSV UTF-8" adds,
openpyxl's read-only/data-only flags, date cells, and row numbers that match what
the user's spreadsheet shows even after a skipped blank row.

Rows are keyed by the file's own header names (whitespace-stripped). One reserved key
rides along on every row: ROW_NUMBER_KEY, the row's real line/sheet row as a string,
for the error report. For a CSV record whose quoted cell spans several lines, that is
the record's *last* physical line (csv.reader.line_num's documented behaviour).
"""

from __future__ import annotations

import csv
import datetime
import io
import zipfile
from collections.abc import Sequence

ROW_NUMBER_KEY = "__row_number__"


class ImportFileError(ValueError):
    """The whole file is unreadable. ``str()`` is shown to the importing user."""


def parse_rows(
    *, filename: str, data: bytes, required_columns: Sequence[str] = ()
) -> list[dict[str, str]]:
    if filename.lower().endswith(".xlsx"):
        header, rows = _parse_xlsx(data)
    else:
        header, rows = _parse_csv(data)
    if required_columns:
        if header is None:
            raise ImportFileError("The file is empty — it needs a header row.")
        missing = [column for column in required_columns if column not in header]
        if missing:
            raise ImportFileError(
                f"Missing required column(s): {', '.join(missing)}. "
                "Header names must match the template exactly."
            )
    return rows


def _parse_csv(data: bytes) -> tuple[list[str] | None, list[dict[str, str]]]:
    try:
        # utf-8-sig strips a BOM if Excel's "CSV UTF-8" added one.
        text = data.decode("utf-8-sig")
    except UnicodeDecodeError as exc:
        raise ImportFileError(
            'The file is not UTF-8 text. In Excel, save it as "CSV UTF-8" or as .xlsx.'
        ) from exc
    reader = csv.DictReader(io.StringIO(text))
    if reader.fieldnames is None:
        return None, []
    reader.fieldnames = [name.strip() for name in reader.fieldnames]
    rows: list[dict[str, str]] = []
    for row in reader:
        entry = {k: (v or "") for k, v in row.items() if k is not None}
        # DictReader skips a fully blank line; line_num still counts it.
        entry[ROW_NUMBER_KEY] = str(reader.line_num)
        rows.append(entry)
    return list(reader.fieldnames), rows


def _parse_xlsx(data: bytes) -> tuple[list[str] | None, list[dict[str, str]]]:
    import openpyxl
    from openpyxl.utils.exceptions import InvalidFileException

    try:
        workbook = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    except (zipfile.BadZipFile, InvalidFileException, KeyError) as exc:
        raise ImportFileError("The file is not a readable .xlsx workbook.") from exc
    try:
        sheet = workbook.active
        # Read-only mode trusts the file's stored size record, which some exporters
        # omit or get wrong (rows silently truncated, or only the header read).
        sheet.reset_dimensions()
        rows_iter = sheet.iter_rows(values_only=True)
        first = next(rows_iter, None)
        if first is None:
            return None, []
        header = [str(cell).strip() if cell is not None else "" for cell in first]
        rows: list[dict[str, str]] = []
        for sheet_row, values in enumerate(rows_iter, start=2):  # header is row 1
            if all(value is None for value in values):
                continue
            rows.append(_xlsx_row(header, values, sheet_row=sheet_row))
        return header, rows
    finally:
        workbook.close()


def _xlsx_row(header: list[str], values: tuple, *, sheet_row: int) -> dict[str, str]:
    """A short row is padded with blanks, as csv.DictReader does (restval)."""
    padded = (*values, *([None] * (len(header) - len(values))))
    entry = {header[i]: _cell_text(padded[i]) for i in range(len(header))}
    entry[ROW_NUMBER_KEY] = str(sheet_row)
    return entry


def _cell_text(value: object) -> str:
    """A cell as the text a user would have typed — a date cell as YYYY-MM-DD."""
    if value is None:
        return ""
    if isinstance(value, datetime.datetime):
        return value.date().isoformat() if value.time() == datetime.time() else value.isoformat()
    if isinstance(value, datetime.date):
        return value.isoformat()
    return str(value)
```

- [ ] **Step 4: Repoint every caller and delete both private copies.**
  - **`student_management/tasks.py`:** import `from core.imports.tabular import parse_rows` and call `rows = parse_rows(filename=filename, data=data, required_columns=REQUIRED_IMPORT_COLUMNS)`, with the tuple imported from `services`. Drop the `row_number=index + 1` argument; `import_student_row` reads `row[ROW_NUMBER_KEY]` itself (Task 2). Keep `enumerate(rows, start=1)` for `update_progress` only. An `ImportFileError` reaches the task's existing `except Exception` → `mark_failed(error=str(exc))`, so the user sees the sentence.
  - **`staff_management/tasks.py`:** the same swap, with `required_columns=REQUIRED_IMPORT_COLUMNS` from `import_staff`. In `import_staff_row`:
    - Use `row[ROW_NUMBER_KEY]` instead of `row["__row_number__"]`.
    - Delete the `"__parse_error__"` branch, since short rows are now padded.
    - Rewrite its docstring's row-number paragraph to cite `core.imports.tabular`.
  - **`attendance/services.py` `parse_attendance_import` and `examinations/services.py` `parse_marks_import`:** change the body to `return parse_rows(filename=filename, data=data)` from `core.imports.tabular`. Rewrite the docstring to "Delegates to `core.imports.tabular`, the parser every importer shares".
  - **`attendance/tasks.py:339` and `examinations/tasks.py:355`:** replace `row_number=index + 1` with `row_number=int(row[ROW_NUMBER_KEY])`, which fixes the same blank-row drift there. Their row functions only index by column name, so the extra key is inert.
  - **Grep check:** `git grep -n "parse_import_rows\|_parse_import_" apps/api` must return nothing.

- [ ] **Step 5: Check the existing tests still fit, and pin the attendance row-number change.**
  - `examinations/tests/test_marks.py:579` still passes its own `row_number`, and its signature is unchanged.
  - Staff's `test_import_export.py` has no row-number or short-row assertion. Those are now covered once, in `core/imports/tests`.
  - Add a task-level drift test to `attendance/tests/test_exports_and_import.py` `ImportEndpointTests`. Tasks run eager, so the job is terminal by the time the response arrives:

```python
    def test_row_numbers_in_the_error_report_survive_a_blank_line(self) -> None:
        response = self.upload(
            content=b"admission_number,attendance_date,status\n\nNOPE,2026-04-01,bogus\n"
        )

        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=response.data["data"]["job_id"])
        self.assertEqual(job.result["errors"][0]["row"], "3")
```

  (`status="bogus"` fails `import_attendance_row`'s status check, `attendance/services.py:1457`, before any date or student lookup. Import `BackgroundJob`/`tenant_context` if the module doesn't already. The old `index + 1` yields `"2"`.)

- [ ] **Step 6 (after go-ahead): Commit.**
  ```bash
  git add apps/api/core/imports apps/api/pyproject.toml apps/api/apps/student_management/services.py apps/api/apps/student_management/tasks.py apps/api/apps/staff_management apps/api/apps/attendance apps/api/apps/examinations/services.py apps/api/apps/examinations/tasks.py docs/decisions
  git commit -m "fix(api): share one bulk-import parser in core/imports

  Root cause: student_management's parser was copied into staff and imported
  cross-app by attendance and examinations; only the staff copy tracked real
  row numbers, and none handled Excel date cells, xlsx size records, misspelled
  headers or non-UTF-8 files."
  ```

---

### Task 2: Backend — per-row correctness in `import_student_row`

**Files:**
- Modify: `apps/api/apps/student_management/services.py` (`import_student_row`, ~1039-1114, and imports)
- Test: `apps/api/apps/student_management/tests/test_import_export_idcards.py` (`StudentImportTests`)

**Interfaces:**
- Consumes: `ROW_NUMBER_KEY` (Task 1).
- Produces: `import_student_row(*, row, tenant_id, actor_id) -> dict[str, str] | None`. The `row_number` parameter is removed. It returns the same `{"row", "field", "issue"}` shape.

- [ ] **Step 1: Write the failing tests.** Add them to `StudentImportTests`, with helpers next to `_upload`:

```python
    def _result(self, content: str | bytes, filename: str = "students.csv") -> dict:
        data = content.encode() if isinstance(content, str) else content
        upload = io.BytesIO(data)
        upload.name = filename
        response = self.client.post("/api/v1/student-imports", {"file": upload}, format="multipart")
        self.assertEqual(response.status_code, status.HTTP_202_ACCEPTED, response.json())
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=response.json()["data"]["job_id"])
        self.assertEqual(job.status, JobStatus.SUCCEEDED, job.error)
        return job.result

    HEADER = "first_name,last_name,date_of_birth,gender,campus_code,admission_date\n"

    def test_rejects_a_gender_outside_the_choices(self) -> None:
        self.allow("students.student.import")
        result = self._result(self.HEADER + "Amina,Khan,2015-06-01,f,MAIN,2026-04-01\n")
        self.assertEqual(result["errors"][0]["field"], "gender")
        with tenant_context(self.tenant.id):
            self.assertFalse(Student.objects.filter(first_name="Amina").exists())

    def test_accepts_gender_case_insensitively_and_stores_it_lowercase(self) -> None:
        self.allow("students.student.import")
        self._result(self.HEADER + "Amina,Khan,2015-06-01,Female,MAIN,2026-04-01\n")
        with tenant_context(self.tenant.id):
            self.assertEqual(Student.objects.get(first_name="Amina").gender, Gender.FEMALE)

    def test_a_bad_admission_date_is_reported_against_admission_date(self) -> None:
        self.allow("students.student.import")
        result = self._result(self.HEADER + "Amina,Khan,2015-06-01,female,MAIN,01/04/2026\n")
        self.assertEqual(result["errors"][0]["field"], "admission_date")

    def test_an_over_length_value_fails_only_its_row(self) -> None:
        self.allow("students.student.import")
        result = self._result(
            self.HEADER
            + f"{'A' * 101},Khan,2015-06-01,female,MAIN,2026-04-01\n"
            + "Bilal,Rahman,2014-01-15,male,MAIN,2026-04-01\n"
        )
        self.assertEqual((result["succeeded"], result["errors"][0]["field"]), (1, "first_name"))

    def test_a_soft_deleted_campus_code_is_not_matched(self) -> None:
        self.allow("students.student.import")
        with tenant_context(self.tenant.id):
            CampusFactory(tenant=self.tenant, code="OLD", deleted_at=timezone.now())
        result = self._result(self.HEADER + "Amina,Khan,2015-06-01,female,OLD,2026-04-01\n")
        self.assertEqual(result["errors"][0]["field"], "campus_code")

    def test_row_numbers_match_the_file_after_a_blank_line(self) -> None:
        self.allow("students.student.import")
        result = self._result(
            self.HEADER + "Amina,Khan,2015-06-01,female,MAIN,2026-04-01\n\nBilal,,2014-01-15,male,MAIN,2026-04-01\n"
        )
        self.assertEqual(result["errors"][0]["row"], "4")

    def test_a_misspelled_header_fails_the_job_with_one_readable_error(self) -> None:
        self.allow("students.student.import")
        upload = io.BytesIO(
            b"First Name,last_name,date_of_birth,gender,campus_code,admission_date\n"
            b"Amina,Khan,2015-06-01,female,MAIN,2026-04-01\n"
        )
        upload.name = "students.csv"
        response = self.client.post("/api/v1/student-imports", {"file": upload}, format="multipart")
        with tenant_context(self.tenant.id):
            job = BackgroundJob.objects.get(pk=response.json()["data"]["job_id"])
        self.assertEqual(job.status, JobStatus.FAILED)
        self.assertIn("first_name", job.error)

    def test_imports_an_xlsx_with_real_date_cells(self) -> None:
        self.allow("students.student.import")
        workbook = openpyxl.Workbook()
        workbook.active.append(self.HEADER.strip().split(","))
        workbook.active.append(
            ["Amina", "Khan", datetime.date(2015, 6, 1), "female", "MAIN", datetime.date(2026, 4, 1)]
        )
        buffer = io.BytesIO()
        workbook.save(buffer)
        result = self._result(buffer.getvalue(), filename="students.xlsx")
        self.assertEqual((result["succeeded"], result["failed"]), (1, 0), result["errors"])
```

  Add `import openpyxl` to the file's imports. If `CampusFactory` doesn't accept `deleted_at`, create the campus and then `Campus.objects.filter(pk=…).update(deleted_at=timezone.now())`, the way `test_csv_rows_are_ordered…` soft-deletes a student.

- [ ] **Step 2: Check the tests fail.** Read them against the current code.
  - `gender="f"` imports successfully.
  - The admission-date error says `date_of_birth`.
  - The 101-char name raises `DataError` and fails the whole job.
  - `OLD` matches the deleted campus.
  - Row `"3"` drifts.
  - The xlsx dates fail. That one is fixed by Task 1, so it also pins the integration.

- [ ] **Step 3: Implement.**
  - **Imports:** add `DataError` to the existing `from django.db import … IntegrityError` line (`services.py:18`). Add `from core.imports.tabular import ROW_NUMBER_KEY`, and add `Gender` to the existing `.models` import if `services.py` doesn't already import it.
  - **Column-length checks:** add a module-level `_LENGTH_CHECKED_COLUMNS = ("first_name", "last_name", "preferred_name", "blood_group", "nationality", "religion", "previous_school")`.
  - **Function body:** rewrite it in this order, keeping the existing `tenant_atomic`/`DomainRuleViolation` handling:

```python
def import_student_row(
    *, row: dict[str, str], tenant_id: uuid.UUID, actor_id: uuid.UUID
) -> dict[str, str] | None:
    """...existing docstring...; the row number comes from ROW_NUMBER_KEY (set by
    core.imports.tabular), never the row's position, so it matches the user's file."""
    import datetime

    from apps.school_organization.models import Campus

    row_number = row[ROW_NUMBER_KEY]

    def error(field: str, issue: str) -> dict[str, str]:
        return {"row": row_number, "field": field, "issue": issue}

    missing = [column for column in REQUIRED_IMPORT_COLUMNS if not row.get(column)]
    if missing:
        return error(missing[0], f"Missing required value for '{missing[0]}'.")

    gender = row["gender"].strip().lower()
    if gender not in Gender.values:
        return error("gender", f"Must be one of: {', '.join(Gender.values)}.")

    dates: dict[str, datetime.date] = {}
    for column in ("date_of_birth", "admission_date"):
        try:
            dates[column] = datetime.date.fromisoformat(row[column].strip())
        except ValueError:
            return error(column, "Must be a date in YYYY-MM-DD format.")

    for column in _LENGTH_CHECKED_COLUMNS:
        limit = Student._meta.get_field(column).max_length
        if limit is not None and len(row.get(column) or "") > limit:
            return error(column, f"Must be at most {limit} characters.")

    try:
        with tenant_atomic(tenant_id):
            try:
                campus = Campus.objects.alive().get(code=row["campus_code"])
            except Campus.DoesNotExist:
                return error("campus_code", f"No campus with code '{row['campus_code']}'.")
            except Campus.MultipleObjectsReturned:
                return error("campus_code", f"More than one campus has code '{row['campus_code']}'.")
            create_student(
                campus=campus,
                admission_date=dates["admission_date"],
                date_of_birth=dates["date_of_birth"],
                first_name=row["first_name"],
                last_name=row["last_name"],
                gender=gender,
                # ...the five optional fields exactly as today...
                actor_id=actor_id,
                tenant_id=tenant_id,
            )
    except DomainRuleViolation as exc:
        detail = exc.detail
        if isinstance(detail, dict) and detail:
            field, issue = next(iter(detail.items()))
            return error(str(field), str(issue))
        return error("non_field", str(detail))
    except IntegrityError:
        return error("non_field", "This row conflicts with existing data.")
    except DataError:
        # Backstop for a column the length check above doesn't cover.
        return error("non_field", "A value in this row doesn't fit its column.")
    return None
```

  - **Callers and docs:** `import_students_task` now calls `import_student_row(row=row, tenant_id=…, actor_id=…)`. Grep `import_student_row(` across `apps/api` for any other caller, such as `test_services.py`, and drop `row_number=` there by giving the row dict `ROW_NUMBER_KEY`. Update `docs/03-modules/student-management.md` §6's "Implementation note (as shipped)" sentence on `POST /student-imports` to add: "gender is matched case-insensitively against `male|female|other|unspecified`; each date and over-length column is reported against its own field."

- [ ] **Step 4: Check the tests pass.** Read through the new body once per test.

- [ ] **Step 5 (after go-ahead): Commit.**
  ```bash
  git add apps/api/apps/student_management docs/03-modules/student-management.md
  git commit -m "fix(students): validate gender, dates and lengths per import row

  Root cause: import_student_row passed gender straight to the model (no DB
  choice constraint), labelled every date failure date_of_birth, looked up
  campuses including soft-deleted ones, and let DataError escape the per-row
  handler so one long value failed the whole job."
  ```

---

### Task 3: Backend — neutralise formula injection in both roster exports

**Files:**
- Modify:
  - `apps/api/core/exports/tabular.py`: rename `_spreadsheet_safe` to `spreadsheet_safe` at lines 96, 127 and 160, and widen its docstring to name the roster exports as callers.
  - `apps/api/apps/student_management/services.py` (`build_student_export_csv`)
  - `apps/api/apps/staff_management/staff/services/export_staff.py`
- Test: `apps/api/apps/student_management/tests/test_import_export_idcards.py` (`StudentExportTests`), `apps/api/apps/staff_management/staff/tests/test_import_export.py` (`StaffExportTests`)

**Interfaces:** Produces `core.exports.tabular.spreadsheet_safe(text: str) -> str`, which is now public.

- [ ] **Step 1: Write the failing tests.**

```python
    # StudentExportTests
    def test_a_formula_shaped_name_is_neutralised(self) -> None:
        with tenant_context(self.tenant.id):
            StudentFactory(tenant=self.tenant, campus=self.campus, first_name='=HYPERLINK("http://x")')
        rows = list(csv.reader(io.StringIO(services.build_student_export_csv(tenant_id=self.tenant.id).decode())))
        self.assertEqual(rows[1][1], '\'=HYPERLINK("http://x")')
```

```python
    # StaffExportTests — same shape, StaffFactory(first_name="@SUM(A1)") → "'@SUM(A1)"
    def test_a_formula_shaped_name_is_neutralised(self) -> None:
        with tenant_context(self.tenant.id):
            StaffFactory(tenant=self.tenant, campus=self.campus, first_name="@SUM(A1)")
        rows = list(csv.reader(io.StringIO(build_staff_export_csv(tenant_id=self.tenant.id).decode())))
        self.assertEqual(rows[1][1], "'@SUM(A1)")
```

- [ ] **Step 2: Check the tests fail.** The raw value is written today.

- [ ] **Step 3: Implement.**
  - In each builder, wrap the data row: `writer.writerow([spreadsheet_safe(str(value)) for value in (...existing values...)])`. Leave the header row unwrapped.
  - Import with `from core.exports.tabular import spreadsheet_safe`.
  - Add one comment line: `# Every cell: names are user-typed, and the file opens in Excel (deferred-work "CSV formula injection").`

- [ ] **Step 4: Update `docs/deferred-work.md`.** Remove the "CSV formula injection in staff/student exports" entry, or mark it closed by students Phase 4, matching how line 753's entry was closed.

- [ ] **Step 5 (after go-ahead): Commit.**
  ```bash
  git add apps/api/core/exports/tabular.py apps/api/apps/student_management apps/api/apps/staff_management docs/deferred-work.md
  git commit -m "fix(api): neutralise spreadsheet formulas in roster CSV exports

  Root cause: build_student_export_csv/build_staff_export_csv wrote user-typed
  names straight into csv.writer, bypassing core.exports' existing mitigation."
  ```

- [ ] **Step 6: Push checkpoint 1 (after go-ahead).** `git push -u origin feat/students-phase4-bulk-ops`, then `gh pr create --draft --base main` with the title `feat(students): phase 4 bulk import, export and ID cards`, then `gh pr checks <n> --watch`. Fix the `api` workflow until it is green before starting the dashboard tasks. A ruff `RUF100`/`BLE`/`TID251` or mypy failure is fixed in code, never suppressed.

---

### Task 4: Dashboard — shared primitives (`downloadFile`, import extensions, close-button passthrough)

**Files:**
- Modify:
  - `apps/dashboard/src/lib/helpers.ts`: add `downloadFile`.
  - `apps/dashboard/src/lib/constants.ts`: add `IMPORT_FILE_EXTENSIONS`.
  - `apps/dashboard/src/services/modules/staff/staff-constant.ts`: delete `ACCEPTED_EXTENSIONS`.
  - `apps/dashboard/src/features/students/student-documents-tab.tsx:140-146`: use `downloadFile(url, title)`.
  - `apps/dashboard/src/components/responsive-dialog.tsx`: add `showCloseButton` to `ResponsiveDialogContent`.
  - `apps/dashboard/src/services/modules/jobs/jobs-service.ts`: add `JobAccepted`.
  - `apps/dashboard/src/services/modules/staff/staff-service.ts`: use `JobAccepted`, and fix the stale "rows that fail produce a `failed` job" comment (they produce a `succeeded` job with `failed > 0`).
- Test: `apps/dashboard/src/lib/__tests__/helpers.test.ts` (create or extend), `apps/dashboard/src/components/__tests__/responsive-dialog.test.tsx` (extend if present)

**Interfaces:**
- Produces:
  - `downloadFile(url: string, filename?: string): void`
  - `IMPORT_FILE_EXTENSIONS = ".csv,.xlsx"`
  - `interface JobAccepted { job_id: string; status: JobStatus }`
  - `ResponsiveDialogContent`'s new `showCloseButton?: boolean` prop, default `true`.

- [ ] **Step 1: Write the failing tests.**

```ts
// lib/__tests__/helpers.test.ts
describe("downloadFile", () => {
  it("clicks a transient anchor pointing at the URL, with the filename hint", () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    downloadFile("https://storage.test/o/1", "students-export.csv");
    // Jest records the receiver (`this`) in `mock.contexts`, not `mock.instances`.
    const anchor = click.mock.contexts[0] as HTMLAnchorElement;
    expect(anchor.href).toBe("https://storage.test/o/1");
    expect(anchor.download).toBe("students-export.csv");
    click.mockRestore();
  });
});
```

```tsx
// components/__tests__/responsive-dialog.test.tsx — uses the file's existing
// `setMatchesMobile` helper (jest.setup.ts's matchMedia shim) to pick each branch.
it.each([
  ["desktop dialog", false],
  ["mobile drawer", true],
])("hides the close button on the %s when showCloseButton is false", (_label, mobile) => {
  setMatchesMobile(mobile);
  render(
    <ResponsiveDialog open onOpenChange={() => {}}>
      <ResponsiveDialogContent closeLabel="Close" showCloseButton={false}>
        <ResponsiveDialogTitle>T</ResponsiveDialogTitle>
      </ResponsiveDialogContent>
    </ResponsiveDialog>,
  );
  expect(screen.queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
});
```

- [ ] **Step 2: Implement.**
  - **`downloadFile`:** add it to `helpers.ts` with a doc comment explaining the transient anchor. `window.open` is avoided because the awaited signed-URL request can lose the user-gesture window. `filename` is a same-origin hint only; cross-origin, `core/files`' `Content-Disposition` names the file. Then make `student-documents-tab.tsx` call it.
  - **`showCloseButton`:** in `ResponsiveDialogContent`, take `showCloseButton = true`. Pass it as `showCloseButton` to `DialogContent` and as `close={showCloseButton}` to `DrawerContent`; `packages/ui/src/components/drawer.tsx:121-138` names the prop `close`, defaulting to `true`.

- [ ] **Step 3 (after go-ahead): Commit.** `refactor(dashboard): shared downloadFile, import extensions and JobAccepted`

---

### Task 5: Dashboard — `useJobFileDownload` hook; migrate `/staff` export onto it

**Files:**
- Create: `apps/dashboard/src/hooks/use-job-file-download.ts`, `apps/dashboard/src/hooks/__tests__/use-job-file-download.test.tsx`
- Modify: `apps/dashboard/src/features/staff/staff-toolbar.tsx`. Delete lines ~96-177 (the trigger, polling, download mutation, effect and `isExporting`), and render from the hook instead.
- Test: `apps/dashboard/src/features/staff/__tests__/staff-toolbar.test.tsx` stays unchanged. It must stay green because staff's export behaviour is identical.

**Interfaces:**
- Consumes: `useJobPolling(module, jobId, callbacks)` (`src/hooks/use-job-polling.ts`), `Services.jobs.fetchFileDownloadUrl`, `downloadFile`, `ExportJobResult`.
- Produces:

```ts
export interface JobFileDownloadMessages {
  startFailed: string;
  downloadFailed: string;
  timedOut: string;
  failed: string;
  /** Receives the succeeded job's `result` (e.g. ID cards' `{count}`). */
  success: (result: Record<string, unknown> | null) => string;
}
export interface UseJobFileDownloadOptions<TArgs> {
  module: string;
  start: (args: TArgs) => Promise<{ jobId: string }>;
  filename: string;
  messages: JobFileDownloadMessages;
}
export interface JobFileDownload<TArgs> {
  /** Starts a job — or, while one is stalled (timed out / poll error), resumes watching it. */
  run: (args: TArgs) => void;
  isBusy: boolean;
  isStalled: boolean;
  progress: number;
}
export function useJobFileDownload<TArgs = void>(
  options: UseJobFileDownloadOptions<TArgs>,
): JobFileDownload<TArgs>;
```

- [ ] **Step 1: Write the failing hook tests.** Use `renderHook` with a wrapper that provides both `NextIntlClientProvider` (the hook calls `useTranslations("errors")`; use the same `locale="en" messages={en}` setup the feature tests' providers use) and one stable `QueryClient`, created once per test outside the wrapper the way `use-job-polling.test.tsx:18-29` does. That is what makes `rerender` reuse the same cache. Use the same `jest.mock("@/services")` shape as `staff-toolbar.test.tsx:26-44`, mock `sonner`, and spy on `HTMLAnchorElement.prototype.click`.
  - `downloads the result file once and toasts success(result)`: `fetchJob` resolves running, then succeeded with `{result_file_id: "f1", count: 3}`. Expect `fetchFileDownloadUrl("f1")` called once, `click` called once, and `toast.success` called with `messages.success`'s return for `{result_file_id:"f1",count:3}`. Rerender several times afterwards, and expect still exactly one download.
  - `run() resumes a stalled job instead of starting another`: use fake timers (`advanceTimersByTimeAsync(120_000)`) as `use-job-polling.test.tsx` does. Expect `isStalled === true`. Then `act(() => result.current.run())` and expect `start` called once in total and `fetchJob` called again.
  - `toasts job.error when the job fails, and the start error when start rejects`.
  - `isBusy covers the gap between succeeded and the download URL resolving`. Hold `fetchFileDownloadUrl` on a pending promise, and expect `isBusy === true`.

- [ ] **Step 2: Implement.** Lift `staff-toolbar.tsx:96-177` into the hook, with three generalisations:
  1. `start`/`module`/`filename`/`messages` come from options.
  2. The download mutation's variables carry the whole result, so `onSuccess` can call `messages.success(result)`.
  3. A `handledJobIdRef` replaces the effect's reliance on `job` reference stability. This means a re-render can never re-download, including after a locale change that alters `messages`.

```ts
"use client";

import { useEffect, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { toast } from "sonner";

import { useJobPolling } from "@/hooks/use-job-polling";
import { resolveErrorMessage } from "@/lib/error-message";
import { downloadFile } from "@/lib/helpers";
import { Services } from "@/services";
import type { ExportJobResult } from "@/services/modules/jobs/jobs-service";

/**
 * Trigger a `202 + job` endpoint whose result is a file, watch the job, and download
 * the file when it succeeds — `/staff` and `/students` export plus students' ID-card
 * PDF. Lifted from `StaffToolbar`'s inline flow; see that history for why a stalled job
 * is resumed rather than re-triggered (a fresh trigger would orphan the running job).
 */
export function useJobFileDownload<TArgs = void>({
  module,
  start,
  filename,
  messages,
}: UseJobFileDownloadOptions<TArgs>): JobFileDownload<TArgs> {
  const tErrors = useTranslations("errors");
  const [jobId, setJobId] = useState<string | null>(null);
  const handledJobIdRef = useRef<string | null>(null);

  const trigger = useMutation({
    mutationFn: start,
    onSuccess: (accepted) => {
      setJobId(accepted.jobId);
    },
    onError: (error: unknown) => {
      toast.error(resolveErrorMessage(error, tErrors, messages.startFailed));
    },
  });

  const { job, isTimedOut, isError, resume } = useJobPolling(module, jobId, {
    onTimedOut: () => toast.error(messages.timedOut),
    onError: () => toast.error(messages.failed),
  });
  const hasActiveJob = jobId !== null && job?.status !== "succeeded" && job?.status !== "failed";
  const isStalled = hasActiveJob && (isTimedOut || isError);

  const { mutate: download, isPending: isDownloadPending } = useMutation({
    mutationFn: async (result: Record<string, unknown> | null) => ({
      url: await Services.jobs.fetchFileDownloadUrl(
        (result as ExportJobResult | null)?.result_file_id ?? "",
      ),
      result,
    }),
    onSuccess: ({ url, result }) => {
      downloadFile(url, filename);
      toast.success(messages.success(result));
    },
    onError: (error: unknown) => {
      toast.error(resolveErrorMessage(error, tErrors, messages.downloadFailed));
    },
  });

  useEffect(() => {
    if (!job || handledJobIdRef.current === job.id) return;
    if (job.status === "succeeded" && (job.result as ExportJobResult | null)?.result_file_id) {
      handledJobIdRef.current = job.id;
      download(job.result);
    } else if (job.status === "failed") {
      handledJobIdRef.current = job.id;
      toast.error(job.error ?? messages.failed);
    }
  }, [job, download, messages.failed]);

  return {
    run: (args: TArgs) => {
      if (isStalled) resume();
      else trigger.mutate(args);
    },
    isBusy: trigger.isPending || isDownloadPending || (hasActiveJob && !isStalled),
    isStalled,
    progress: job?.progress ?? 0,
  };
}
```

  (The interfaces from **Interfaces** sit above the function in the same file.)

- [ ] **Step 3: Migrate `StaffToolbar`.** Replace the deleted block with:

```tsx
  const exportJob = useJobFileDownload({
    module: "staff",
    start: () => Services.staff.triggerStaffExport(),
    filename: STAFF_EXPORT_FILENAME,
    messages: {
      startFailed: t("export.startFailed"),
      downloadFailed: t("export.downloadFailed"),
      timedOut: t("export.timedOut"),
      failed: t("export.failed"),
      success: () => t("export.success"),
    },
  });
```

  - Render the button with `disabled={!canExport || exportJob.isBusy}` and `onClick={() => exportJob.run()}`. Its label is `exportJob.isBusy ? t("export.exporting") : exportJob.isStalled ? t("export.checkStatus") : t("export.button")`.
  - Add `export const STAFF_EXPORT_FILENAME = "staff-export.csv";` to `staff-constant.ts`, replacing the literal.
  - Remove the now-unused imports: `useEffect`, `useMutation`, `toast` (sonner), `useJobPolling`, `resolveErrorMessage`, `ExportJobResult`, and the `tErrors` binding. `--max-warnings 0` fails on any one left behind.

- [ ] **Step 4: Check against the staff tests.** Read `staff-toolbar.test.tsx`'s ten export cases against the new toolbar: success download, download-URL failure, trigger failure, permission disabled/titles, timeout, job failed, resume-after-timeout without a second trigger, re-check after a poll error, and poll error. Each must still hold without editing the test. If one asserted on an internal detail rather than behaviour, fix the assertion and say why in the commit body.

- [ ] **Step 5 (after go-ahead): Commit.** `refactor(dashboard): extract useJobFileDownload from the staff export flow`

---

### Task 6: Dashboard — shared `BulkImportDialog`; migrate `/staff` import onto it

**Files:**
- Create: `apps/dashboard/src/components/bulk-import-dialog.tsx`, `apps/dashboard/src/components/__tests__/bulk-import-dialog.test.tsx`
- Delete: `apps/dashboard/src/features/staff/staff-import-dialog.tsx`, `apps/dashboard/src/features/staff/__tests__/staff-import-dialog.test.tsx`. Their cases move into the new test, re-targeted at props.
- Modify:
  - `apps/dashboard/src/features/staff/staff-toolbar.tsx`: render `BulkImportDialog`.
  - `apps/dashboard/src/services/modules/staff/staff-constant.ts`: rename `ACTIVE_JOB_STORAGE_PREFIX` to `STAFF_IMPORT_JOB_STORAGE_PREFIX` and `REQUIRED_COLUMNS`/`OPTIONAL_COLUMNS` to `STAFF_IMPORT_REQUIRED_COLUMNS`/`STAFF_IMPORT_OPTIONAL_COLUMNS`. The values do not change, so a session's stored job still reconnects. Then grep and fix every importer.
  - `apps/dashboard/messages/en.json` and `ur.json`: add a top-level `bulkImport` namespace, and prune `staff.import` and `students.import`.

**Interfaces:**
- Consumes: `useJobPolling`, `useSessionStorageState`, `useCurrentUser`, `resolveErrorMessage`, `queryKeys.module`, `IMPORT_FILE_EXTENSIONS`, `ResponsiveDialog*` (with `showCloseButton`), and `ImportJobResult`.
- Produces:

```ts
export interface BulkImportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Query-key root: the job watch's, and what a successful import invalidates (plus "dashboard"). */
  module: string;
  title: string;
  description: string;
  requiredColumns: readonly string[];
  optionalColumns: readonly string[];
  /** Per-module sessionStorage prefix; the signed-in user's id is appended. */
  storageKeyPrefix: string;
  start: (file: File) => Promise<{ jobId: string }>;
}
export function BulkImportDialog(props: BulkImportDialogProps): JSX.Element;
```

- [ ] **Step 1: i18n.** Do this in both locale files.
  - **Create the `bulkImport` namespace.** Move these keys out of `staff.import` with their existing values, so `ur.json`'s Urdu comes from `staff.import` too: `templateTitle`, `templateHint`, `fields.file`, `upload`, `processing`, `failed`, `summarySucceeded`, `summaryFailed`, `startFailed`, `timedOut`, `close`, `runInBackground`, `errorTable.{row,field,issue}`.
  - **`staff.import`** becomes `{button, permissionTitle, title, description}`.
  - **`students.import`** becomes `{button, permissionTitle, title, description}`:
    - `button`: en "Import CSV" / ur "CSV درآمد کریں".
    - `permissionTitle`: en "You don't have permission to import students." / ur "آپ کو طلبہ درآمد کرنے کی اجازت نہیں ہے۔".
  - **Drop the unused `importAnother` key** from both namespaces (no `src` reference).

- [ ] **Step 2: Write the failing tests.** Port every case in `staff-import-dialog.test.tsx` into `bulk-import-dialog.test.tsx`. Render `<BulkImportDialog … start={mockStart} module="things" storageKeyPrefix="schoolhub:things-import-job:" requiredColumns={["a"]} optionalColumns={["b"]} title="Import things" description="d" />` in place of `StaffImportDialog`, keep the `jobs.fetchJob`/`auth.fetchCurrentUser` mocks, and replace `staff.triggerStaffImport` assertions with `mockStart`. Keep:
  - **Upload, poll and result:** upload → poll → summary badges plus the row-error table; the failed job alert.
  - **Error paths:** the start error preferring the `file` field detail; poll timeout and transient poll error keeping the input locked.
  - **Background job and storage:** "Run in background" survives close/reopen through sessionStorage. A 404 poll drops the stored job. A finished job clears storage on close.
  - **Invalidation:** after `succeeded > 0`, invalidate `["things"]` and `["dashboard"]`. Spy on `queryClient.invalidateQueries`.
  - **New case:** the dialog title and description come from props, and the required/optional column badges render.

- [ ] **Step 3: Implement.**
  - **Port the logic.** `bulk-import-dialog.tsx` is `staff-import-dialog.tsx` with the staff specifics swapped for props: `Services.staff.triggerStaffImport` → `start`, `"staff"` → `module`, `ACTIVE_JOB_STORAGE_PREFIX` → `storageKeyPrefix`, the column constants → props, and `useTranslations("staff")`'s `import.*` → `useTranslations("bulkImport")`. `title`/`description` come from props. Keep every existing comment that explains a behaviour: the three-way footer label, the `hasActiveJob` vs `isPolling` distinction, why closing is blocked mid-upload, and the bounded error-table height.
  - **Swap the dialog shell.** Use `ResponsiveDialog`/`ResponsiveDialogContent closeLabel={t("close")} showCloseButton={!trigger.isPending}`/`ResponsiveDialogHeader`/`Title`/`Body`/`Footer` instead of `Dialog*`. The mobile drawer is the roadmap's mobile audit item; staff's import was the one dialog left out of `feat/staff-mobile-drawers`.
  - **Use the shared extensions.** `accept={IMPORT_FILE_EXTENSIONS}`.

- [ ] **Step 4: Migrate `StaffToolbar`.**

```tsx
      <BulkImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        module="staff"
        title={t("import.title")}
        description={t("import.description")}
        requiredColumns={STAFF_IMPORT_REQUIRED_COLUMNS}
        optionalColumns={STAFF_IMPORT_OPTIONAL_COLUMNS}
        storageKeyPrefix={STAFF_IMPORT_JOB_STORAGE_PREFIX}
        start={Services.staff.triggerStaffImport}
      />
```

  The e2e `staff.spec.ts` import test locates `getByRole("dialog", { name: "Import staff" })`, `getByLabel("File")` and `"Upload"`. All three strings are unchanged.

- [ ] **Step 5: Check for leftovers.** `git grep -n "StaffImportDialog\|staff-import-dialog\|ACTIVE_JOB_STORAGE_PREFIX\|ACCEPTED_EXTENSIONS\|staff.import.upload" apps/dashboard e2e .claude docs` must return nothing outside historical plan files under `docs/superpowers/plans/`. Task 11 fixes the skill and AGENTS references this grep finds.

- [ ] **Step 6 (after go-ahead): Commit.** `refactor(dashboard): extract BulkImportDialog from the staff import dialog`

---

### Task 7: Dashboard — students services for import, export and ID cards

**Files:**
- Modify:
  - `apps/dashboard/src/services/endpoints.ts`
  - `apps/dashboard/src/services/modules/students/students-service.ts`
  - `apps/dashboard/src/services/modules/students/index.ts`
  - `apps/dashboard/src/services/modules/students/students-constant.ts`
  - `apps/dashboard/src/services/modules/students/students-type.ts`
- Test: `apps/dashboard/src/services/modules/students/__tests__/students-service.test.ts`, `apps/dashboard/src/services/__tests__/endpoints.test.ts` (if present)

**Interfaces:**
- Produces:
  - `endpoints.students.imports = "/student-imports"`, `endpoints.students.exports = "/student-exports"`, `endpoints.idCards.generate = "/id-cards:generate"` (a new top-level group with its own doc comment: a colon-action, `POST` only).
  - `Services.students.triggerStudentImport(file: File): Promise<{ jobId: string }>` (multipart `file`)
  - `Services.students.triggerStudentExport(): Promise<{ jobId: string }>`
  - `Services.students.generateIdCards(studentIds: string[]): Promise<{ jobId: string }>`
  - In `students-constant.ts`:
    - `STUDENT_IMPORT_REQUIRED_COLUMNS = ["first_name","last_name","date_of_birth","gender","campus_code","admission_date"] as const`
    - `STUDENT_IMPORT_OPTIONAL_COLUMNS = ["preferred_name","blood_group","nationality","religion","previous_school"] as const`
    - `STUDENT_IMPORT_JOB_STORAGE_PREFIX = "schoolhub:students-import-job:"`
    - `STUDENT_EXPORT_FILENAME = "students-export.csv"`
    - `ID_CARDS_FILENAME = "id-cards.pdf"`
    - A doc comment on the column lists citing `apps/api/apps/student_management/services.py`'s `REQUIRED_IMPORT_COLUMNS`/`IMPORT_COLUMNS`.
  - In `students-type.ts`: `export type IdCardGenerateBody = ApiSchemas["IdCardGenerateRequest"];` and `export interface IdCardJobResult extends ExportJobResult { count: number }`.

- [ ] **Step 1: Write the failing tests** in `students-service.test.ts`, following the file's existing `apiClient` mock style:
  - `triggerStudentImport` posts a `FormData` holding `file` to `/student-imports` and maps `job_id` → `jobId`.
  - `triggerStudentExport` posts with no body to `/student-exports`.
  - `generateIdCards(["a","b"])` posts `{ student_ids: ["a","b"] }` to `/id-cards:generate`.

- [ ] **Step 2: Implement.** Copy `staff-service.ts`'s `triggerStaffImport`/`triggerStaffExport` shapes, using `apiClient.post<JobAccepted>(…)` and `endpoints.students.*`/`endpoints.idCards.generate`. Register all three in `index.ts`'s `StudentsService`.

- [ ] **Step 3 (after go-ahead): Commit.** `feat(students): service calls for import, export and ID-card jobs`

---

### Task 8: Dashboard — `/students` toolbar Export and Import

**Files:**
- Modify:
  - `apps/dashboard/src/features/students/student-toolbar.tsx`
  - `apps/dashboard/src/app/(app)/shell/toolbar.tsx`: `ToolbarActions` gains `flex-wrap`.
  - `apps/dashboard/messages/en.json` and `ur.json`: add the `students.export` namespace.
- Test: `apps/dashboard/src/features/students/__tests__/student-toolbar.test.tsx`

**Interfaces:** Consumes `useJobFileDownload` (Task 5), `BulkImportDialog` (Task 6) and the Task 7 services and constants.

- [ ] **Step 1: i18n.** Add `students.export`, mirroring `staff.export`'s keys:

Urdu is aligned word-for-word with `staff.export` (`ur.json:697-707`), with only the noun changed from عملہ to طلبہ:

| Key | en | ur |
|---|---|---|
| `button` | Export CSV | CSV برآمد کریں |
| `exporting` | Exporting… | برآمد ہو رہا ہے… |
| `checkStatus` | Check export status | برآمد کی صورتحال چیک کریں |
| `permissionTitle` | You don't have permission to export students. | آپ کو طلبہ برآمد کرنے کی اجازت نہیں ہے۔ |
| `success` | Student list exported | طلبہ کی فہرست برآمد ہو گئی |
| `startFailed` | The export could not be started. | برآمد شروع نہیں ہو سکا۔ |
| `downloadFailed` | The export file could not be downloaded. | برآمد شدہ فائل ڈاؤن لوڈ نہیں ہو سکی۔ |
| `timedOut` | The export is taking longer than expected. Try again in a moment. | برآمد میں معمول سے زیادہ وقت لگ رہا ہے۔ تھوڑی دیر بعد دوبارہ کوشش کریں۔ |
| `failed` | The export failed. | برآمد ناکام ہو گئی۔ |

- [ ] **Step 2: Write the failing tests** in `student-toolbar.test.tsx`, extending its existing mocks with `students.triggerStudentExport`/`triggerStudentImport`, `jobs.fetchJob` and `jobs.fetchFileDownloadUrl`:
  - **Default permissions:** with `students.student.create` only, "Export CSV" and "Import CSV" are disabled, with their `permissionTitle`s on the wrapping span.
  - **With `students.student.export`:** clicking Export calls `triggerStudentExport` once. A succeeded job with `{result_file_id:"f1"}` calls `fetchFileDownloadUrl("f1")` and toasts "Student list exported".
  - **With `students.student.import`:** clicking Import opens a dialog named "Import students" listing `campus_code` as a required-column badge.
  - **While permissions load:** both buttons are disabled, with `common.permissionsLoading` as the title.

- [ ] **Step 3: Implement.** In `StudentToolbar`:
  - Add `canExport`/`canImport` via `hasPermission`, plus `exportTitle`/`importTitle`. These follow the `staff-toolbar.tsx` pattern: `permissionsUnknownTitle ?? (canX ? undefined : t("x.permissionTitle"))`.
  - Wire `const exportJob = useJobFileDownload({ module: "students", start: () => Services.students.triggerStudentExport(), filename: STUDENT_EXPORT_FILENAME, messages: {...students.export.*, success: () => t("export.success")} })`.
  - Add `importOpen` state.
  - In `<ToolbarActions>`, put two `variant="outline"` buttons (Export, then Import) before New student, each inside `<span title=…>`.
  - Mount `<BulkImportDialog module="students" title={t("import.title")} description={t("import.description")} requiredColumns={STUDENT_IMPORT_REQUIRED_COLUMNS} optionalColumns={STUDENT_IMPORT_OPTIONAL_COLUMNS} storageKeyPrefix={STUDENT_IMPORT_JOB_STORAGE_PREFIX} start={Services.students.triggerStudentImport} … />` next to `StudentFormDialog`.
  - **Mobile/RTL (the roadmap's audit item):** `ToolbarActions` (`apps/dashboard/src/app/(app)/shell/toolbar.tsx:24-26`) is `flex items-center gap-2.5` with no wrap. Three buttons (four labels in Urdu) overflow at 375px.
    - Change it to `flex flex-wrap items-center gap-2.5`. It is a shell primitive, so `/staff` benefits too. `gap` is direction-agnostic, so RTL needs nothing else.
    - Every new class in this phase uses logical or direction-neutral utilities only (`gap-*`, `ms-*`/`me-*` if any spacing is added), never `ml-*`/`mr-*`.
    - The roadmap's visual 375px/`ur` check is the user's manual smoke (Verification). No local dev server is started by the implementer.

- [ ] **Step 4 (after go-ahead): Commit.** `feat(students): export and import from the directory toolbar`

---

### Task 9: Dashboard — ID-card batch action

**Files:**
- Create: `apps/dashboard/src/features/students/student-id-cards-button.tsx`, `apps/dashboard/src/features/students/__tests__/student-id-cards-button.test.tsx`
- Modify:
  - `apps/dashboard/src/features/students/student-directory-table.tsx`: in `CardToolbar`, before the bulk-withdraw button.
  - `apps/dashboard/messages/en.json` and `ur.json`: `students.idCards`.
- Test: also extend `apps/dashboard/src/features/students/__tests__/student-directory-table.test.tsx`.

**Interfaces:**
- Consumes: `useJobFileDownload<string[]>`, `Services.students.generateIdCards`, `IdCardJobResult`, `ID_CARDS_FILENAME`.
- Produces: `StudentIdCardsButton({ studentIds }: { studentIds: string[] })`.

- [ ] **Step 1: i18n.** In `students.idCards`, keep `selectAll`, `selectRow`, `generate`, `generating` and `failed`, and remove `download` and `dismiss`. Add:

| Key | en | ur |
|---|---|---|
| `checkStatus` | Check ID-card status | شناختی کارڈ کی صورتحال دیکھیں |
| `success` | ID cards ready ({count}) | شناختی کارڈ تیار ہیں ({count}) |
| `startFailed` | ID-card generation could not be started. | شناختی کارڈ بنانا شروع نہیں ہو سکا۔ |
| `downloadFailed` | The ID-card PDF could not be downloaded. | شناختی کارڈ کی PDF ڈاؤن لوڈ نہیں ہو سکی۔ |
| `timedOut` | ID cards are taking longer than expected — check again shortly. | شناختی کارڈ بننے میں توقع سے زیادہ وقت لگ رہا ہے — تھوڑی دیر بعد دوبارہ دیکھیں۔ |

- [ ] **Step 2: Write the failing tests** (`student-id-cards-button.test.tsx`):
  - `renders nothing with no selection and no job`.
  - `posts the selected ids and downloads the PDF`: rendered with `["s1","s2"]`, the label is "Generate ID cards (2)". Clicking calls `generateIdCards(["s1","s2"])`. A succeeded job with `{result_file_id:"f1",count:2}` triggers a download and toasts "ID cards ready (2)".
  - `stays visible while generating after the selection empties`: start a job, then `rerender` with `studentIds={[]}`. The button is still present, disabled, and reads "Generating — 40%" for a running job at progress 40.
  - `offers "Check ID-card status" after a timeout and resumes the same job`: `generateIdCards` is called once in total.

  In `student-directory-table.test.tsx`:
  - The ID-card button is absent without `students.id-card.generate`.
  - Selecting two rows with the key shows "Generate ID cards (2)".

- [ ] **Step 3: Implement** `student-id-cards-button.tsx`:

```tsx
"use client";

import { Button } from "@schoolhub/ui";
import { IdCard } from "lucide-react";
import { useTranslations } from "next-intl";

import { useJobFileDownload } from "@/hooks/use-job-file-download";
import { Services } from "@/services";
import { ID_CARDS_FILENAME } from "@/services/modules/students/students-constant";
import type { IdCardJobResult } from "@/services/modules/students/students-type";

/**
 * Batch ID cards for the directory's current-page selection (`POST /id-cards:generate`,
 * one merged PDF). Always mounted while the viewer may generate, so a running job keeps
 * its progress visible after the selection clears or the page changes; hidden only when
 * there is neither a selection nor a job in flight.
 */
export function StudentIdCardsButton({ studentIds }: { studentIds: string[] }) {
  const t = useTranslations("students");
  const idCards = useJobFileDownload<string[]>({
    module: "students",
    start: (ids) => Services.students.generateIdCards(ids),
    filename: ID_CARDS_FILENAME,
    messages: {
      startFailed: t("idCards.startFailed"),
      downloadFailed: t("idCards.downloadFailed"),
      timedOut: t("idCards.timedOut"),
      failed: t("idCards.failed"),
      success: (result) => t("idCards.success", { count: (result as IdCardJobResult | null)?.count ?? 0 }),
    },
  });

  if (studentIds.length === 0 && !idCards.isBusy && !idCards.isStalled) return null;

  return (
    <Button
      variant="outline"
      disabled={idCards.isBusy || (studentIds.length === 0 && !idCards.isStalled)}
      onClick={() => {
        idCards.run(studentIds);
      }}
    >
      <IdCard aria-hidden="true" />
      {idCards.isBusy
        ? t("idCards.generating", { progress: idCards.progress })
        : idCards.isStalled
          ? t("idCards.checkStatus")
          : t("idCards.generate", { count: studentIds.length })}
    </Button>
  );
}
```

  In `student-directory-table.tsx`:
  - Add `const canGenerateIdCards = hasPermission(currentUser, "students.id-card.generate");`.
  - In `<CardToolbar>`, before the withdraw `m.div`, add `{canGenerateIdCards && <StudentIdCardsButton studentIds={selected.map((s) => s.id)} />}`. It covers every selected status, unlike withdraw's active-only subset: the backend renders any live student.

- [ ] **Step 4 (after go-ahead): Commit.** `feat(students): batch ID-card generation from the directory selection`

---

### Task 10: E2E — mocked `dashboard` lane

**Files:**
- Modify: `e2e/src/mocks/domains/students.ts`, `e2e/src/pages/dashboard/students.page.ts`, `e2e/src/mocks/index.ts` (re-export the new job-id constants if `STAFF_*_JOB_ID` is re-exported there), `e2e/tests/dashboard/staff.spec.ts` (Step 3's comment only)
- Create: `e2e/tests/dashboard/students-bulk.spec.ts`

**Interfaces:**
- Produces:
  - `STUDENT_EXPORT_JOB_ID = "job-student-export"`, `STUDENT_IMPORT_JOB_ID = "job-student-import"`, `ID_CARDS_JOB_ID = "job-id-cards"`.
  - `StudentOptions.onIdCardsRequested?: (ids: string[]) => void`.
  - Page-object getters: `exportCsvButton`, `importCsvButton`, `importDialog` (`getByRole("dialog", { name: "Import students" })`), `importFileInput`, `importSubmit`, `idCardsButton` (`getByRole("button", { name: /Generate ID cards|Generating|Check ID-card status/ })`), and `selectRow(name)` (`row(name).getByRole("checkbox", { name: "Select this student" })`).

- [ ] **Step 1: Add the mock handlers** in `studentsModule`, mirroring `staff.ts:190-195`:

```ts
    api.post("/student-exports", () =>
      ok({ job_id: STUDENT_EXPORT_JOB_ID, status: "queued" }, { status: 202 }),
    );
    api.post("/student-imports", () =>
      ok({ job_id: STUDENT_IMPORT_JOB_ID, status: "queued" }, { status: 202 }),
    );
    // `router.ts` compiles `:generate` as a param that captures the literal ":generate"
    // segment tail — the same trick `/students/:studentAction` relies on for colon-actions.
    api.post("/id-cards:generate", (request) => {
      const body = (request.json() as { student_ids?: string[] } | null) ?? {};
      options.onIdCardsRequested?.(body.student_ids ?? []);
      return ok({ job_id: ID_CARDS_JOB_ID, status: "queued" }, { status: 202 });
    });
```

- [ ] **Step 2: Write `students-bulk.spec.ts`.** Import from `@/fixtures` only, and copy `staff.spec.ts:189-275`'s structure, with `test.use({ authUser: buildUser({ permissions: [...SCHOOL_ADMIN_PERMISSIONS, "students.student.export", "students.student.import", "students.id-card.generate"] }) })`:
  - **Export:** `jobsModule` serves running → succeeded `{result_file_id:"file-students-export"}`. Assert `page.waitForEvent("download")`'s URL.
  - **Import:** a succeeded job with `errors: [{ row: "3", field: "gender", issue: "Must be one of: male, female, other, unspecified." }]`. Assert the issue text is visible in `importDialog`.
  - **ID cards:** seed two students. Select both, then click `idCardsButton` ("Generate ID cards (2)"). Assert `onIdCardsRequested` received both ids, then assert the download event.
  - **"A user without the bulk keys sees Export/Import disabled and no ID-card button":** runs in the outer describe (default `SCHOOL_ADMIN_PERMISSIONS`). This is not "a school_admin": the real `school_admin` role holds all three keys (`permissions.py:58`), and the E2E constant is a nav-filtering subset.
  - **Storage-route stubs:** every one fulfils with `headers: { "content-disposition": 'attachment; filename="…"' }` as `core/files/services.py:122-126` does in production. A cross-origin `<a download>` ignores the attribute, so the header is what makes Chromium emit the `download` event reliably.

  Each test also `mockApi.use(schoolOrganizationModule(...), studentsModule({ students }))`, as `students.spec.ts` does.

- [ ] **Step 3: Remove the stale staff comment.** `staff.spec.ts:209-213`'s "`ResponseContentDisposition` is deferred" comment has been out of date since students Phase 2. Change it to: "asserts a download happens, not its name — `Content-Disposition` names it in production".

- [ ] **Step 4 (after go-ahead): Commit.** `test(e2e): students bulk export, import and ID cards`

---

### Task 11: Docs, graph, final push and PR

**Files:**
- Modify:
  - `docs/03-modules/student-management.md` §20: add a "Dashboard, Phase 4 (as shipped)" paragraph.
  - `docs/project-status.md`: Tier 1 row, matrix row (including the E2E cell: add `tests/dashboard/students-bulk.spec.ts`), "Start here next" item 12.
  - `docs/deferred-work.md`
  - `docs/02-architecture/repo-structure.md`: §1's layout lists `core/imports/`; §5's rule-of-three line.
  - `apps/api/AGENTS.md:20-33`: add `core/imports/` to the core layout list.
  - `apps/dashboard/AGENTS.md:66`: the wiring table names `BulkImportDialog` (`src/components/`) and `useJobFileDownload` (`src/hooks/`) as the import and export/job-file patterns.
  - `.claude/skills/schoolhub-dashboard-screen/SKILL.md:533-538`: point the import/export guidance at the shared pieces, and fix its stale `app/(app)/staff/` path to `features/staff/`.
  - `docs/07-quality/2026-09-module-audit-findings.md`: mark rows 68 (missing-header pre-check) and 69 (row-number drift) closed by students Phase 4.

- [ ] **Step 1: Module doc §20 Phase 4.** Cover:
  - Toolbar Export/Import gated by `students.student.export`/`.import`.
  - The shared `BulkImportDialog`, a drawer on mobile, with a required/optional column reference and no template download.
  - The ID-card batch action over the current-page selection, gated by `students.id-card.generate`.
  - Backend changes: the `core/imports` parser now shared by four importers; per-row gender/date/length/campus validation; formula-safe exports.
  - `/staff` migrated onto the same components.

- [ ] **Step 2: `project-status.md`.**
  - **Tier 1 row and student-management matrix row:** dashboard "**Phase 4 shipped** — student-management full-stack complete; Tier 1 done".
  - **Item 12:** replace "Start here next: Phase 4" with the next candidate: dashboard screens for `academics` (build order `academics → timetable → attendance`, per the Tier 2 row), or communication PR C. State both and let the next session choose.

- [ ] **Step 3: `deferred-work.md`.**
  - **Close:** "CSV formula injection" (Task 3).
  - **Add:**
    - Import template download.
    - Guardian/enrollment import (§9/§8; students only today).
    - ID-card photo, school name and logo (`render_id_cards_pdf` prints none; `uploads.py` says the photo is "also printed on ID cards").
    - ID-card generation writes no audit record (import/export do).
    - The `students.import-result` notification (§12) is not emitted.
    - The staff importer has no per-column length pre-check or `DataError` backstop (the student one now has both).
    - Attendance and examinations importers don't pass `required_columns` to `parse_rows` yet, so a misspelled header there still yields one row error per row.
    - No live-lane journey for import/export/ID cards. The Celery worker path is covered by backend tests with eager tasks only.
  - **Extend the existing `GET /files` exposure entry** (`deferred-work.md:909-924`, ADR-0021): any staff role holding `platform.file.view` can list and download the `student.export`, `student.id-card-batch` and `staff.export` purposes, which are whole-roster PII. No `core/files` change in this PR; repeat it in the PR's Deferred section.
- [ ] **Step 4: `repo-structure.md` §5.** Change "the staff and student import/document pipelines" to "the staff and student document pipelines". Import parsing now lives in `core/imports/`.
- [ ] **Step 5:** Run `graphify update .` (AST-only; `graphify-out/` is gitignored, so this does not change the commit).
- [ ] **Step 6 (after go-ahead): Commit and push.** Commit with `docs(students): phase 4 as shipped; close formula-injection entry`. Then push and `gh pr ready <n>`. Edit the PR body: an **ELI5** section first (analogy: "a school office that used to type every new pupil's card by hand now gets a photocopier with a proofreader — feed it a stack, and it tells you exactly which sheet had a typo"), then Description, Backend changes, Dashboard changes, Testing (CI only), and Deferred.
- [ ] **Step 7:** `gh pr checks <n> --watch` until it is green: `api`, `frontend` (lint, typecheck, test, coverage ≥85%, build, Playwright) and `repo-hygiene` (doc-sync, cspell, Prettier, plan-review record). Then dispatch `change-reviewer` with this plan, and address its findings. **Stop at "PR open, CI green"**; the human merges.

## Verification (end to end)

- **CI on the PR is the verdict.**
  - `api`: the new `core/imports/tests`, the extended student and staff import/export tests, `test_import_boundaries` (`core` imports no app), and the unchanged attendance/examinations suites.
  - `frontend`: hook, dialog, toolbar, ID-card button and service tests; the 85% coverage floor; and the Playwright `students-bulk.spec.ts` plus the unchanged `staff.spec.ts` import/export cases.
- **Manual smoke after merge** (optional, by the user on the compose stack): in `/students` as an `it_admin`:
  - Export, and confirm the CSV downloads.
  - Import a two-row .xlsx typed in Excel with one bad gender, and confirm 1 imported, plus the row-3 `gender` error.
  - Select three rows, generate ID cards, and confirm a 3-page PDF.
  - Confirm `/staff` export/import still behave identically.

## Independent review

- **Reviewer:** plan-reviewer agent, 2026-10-10
- **Verdict:** REVISE. The approach is sound and nearly every origin/main reference was verified correct. Six Medium and five Low findings needed fixing before implementation. None was a wrong approach or an unproven cause.
- **Findings addressed:** All eleven were folded into this plan before approval.
  1. `ResponsiveDialogContent` maps `showCloseButton` to the drawer's real `close` prop, with a mobile-branch test (Task 4).
  2. Short xlsx rows are padded like CSV's `restval`. `reset_dimensions()`/`workbook.close()` were added, and `PARSE_ERROR_KEY` was dropped everywhere (Task 1, Alternatives).
  3. A header-row check is in scope: `parse_rows(required_columns=…)` raises one readable `ImportFileError`. Students and staff pass theirs; attendance/exams are recorded in deferred-work (Tasks 1, 2, 11).
  4. The `GET /files` exposure of roster/ID-card purposes is recorded against the existing ADR-0021 entry (Task 11).
  5. ADR-0023 records the `core/imports` row contract (Task 1).
  6. Doc-sync gaps are closed: api AGENTS, repo-structure §1/§5, the dashboard-screen skill (plus its stale path), the dashboard AGENTS table, the audit findings rows 68/69, the mypy strict list, and the project-status E2E cell (Tasks 1, 11).
  7. The wrong staff-test claim is corrected, and an attendance task-level row-number test was added (Task 1).
  8. Fixes in Tasks 2, 4 and 5:
     - The hook test wrapper provides next-intl and a stable QueryClient.
     - `toast` was added to the removed imports.
     - Tests use `setMatchesMobile`.
     - The anchor is read from `mock.contexts`.
     - `DataError` joins the existing import line.
  9. The E2E default-role case is renamed, and storage stubs send `content-disposition` (Task 10).
  10. `ToolbarActions` gains `flex-wrap`, with a stated RTL rule and the visual check assigned to the user's smoke test (Task 8).
  11. Review Focus gained the four visible behaviour changes. The parser docstring notes the `line_num` caveat. Task 10 Files lists `staff.spec.ts`, Task 3 has its `git add`, and the Urdu matches `staff.export`.
- **Unresolved:** None. The reviewer's three open questions were settled by the author within the user's chosen scope ("fix import + export"): the header check is in, short rows are padded, and the ADR was added. They are listed above so the user can veto any of them at approval.
