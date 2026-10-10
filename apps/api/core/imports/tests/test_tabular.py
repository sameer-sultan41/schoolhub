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
        bom = chr(0xFEFF)
        rows = parse_rows(filename="s.csv", data=(bom + "first_name\nAmina\n").encode())
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
