"""Typed report rows (ADR-0022): every `kind`'s inline rows validate against the
schema component the generated contract publishes for it."""

from __future__ import annotations

import copy
import csv
import io
from decimal import Decimal
from typing import Any

import jsonschema
from drf_spectacular.generators import SchemaGenerator
from rest_framework import status

from apps.examinations import reports
from apps.examinations.report_serializers import REPORT_ROW_SERIALIZERS
from apps.examinations.tests.factories import QuestionBankFactory, QuestionFactory
from apps.examinations.tests.test_processing import ProcessingTestCase
from apps.examinations.tests.test_reports import SUMMARY, ReportDataTestCase
from core.tenancy.context import tenant_context


def _json_schema(node: Any) -> Any:
    """OpenAPI 3.0's `nullable` as JSON Schema's `null` type, recursively.

    The rest of OpenAPI 3.0's schema dialect is JSON Schema Draft 4's.
    """
    if isinstance(node, list):
        return [_json_schema(item) for item in node]
    if not isinstance(node, dict):
        return node
    converted = {key: _json_schema(value) for key, value in node.items() if key != "nullable"}
    if node.get("nullable"):
        if "type" in converted:
            converted["type"] = [converted["type"], "null"]
        else:
            converted = {"anyOf": [converted, {"type": "null"}]}
    return converted


class ReportRowSchemaTests(ReportDataTestCase):
    @classmethod
    def setUpClass(cls) -> None:
        super().setUpClass()
        cls.schema = SchemaGenerator().get_schema(request=None, public=True)

    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            bank = QuestionBankFactory(tenant=self.tenant, subject=self.subject)
            QuestionFactory(tenant=self.tenant, question_bank=bank)

    def component(self, name: str) -> dict:
        components = self.schema["components"]["schemas"]
        root = copy.deepcopy(components[name])
        root["components"] = {"schemas": copy.deepcopy(components)}
        return _json_schema(root)

    def rows(self, kind: str) -> list[dict]:
        response = self.client.get(SUMMARY, {"kind": kind, "exam_id": str(self.exam.pk)})
        self.assertEqual(response.status_code, status.HTTP_200_OK, response.json())
        return response.json()["data"]

    def test_the_schema_names_one_row_type_per_kind(self) -> None:
        row = self.schema["components"]["schemas"]["ExamReportRow"]

        self.assertEqual(row["discriminator"]["propertyName"], "kind")
        self.assertEqual(set(row["discriminator"]["mapping"]), set(reports.REPORT_KINDS))
        self.assertEqual(set(REPORT_ROW_SERIALIZERS), set(reports.REPORT_KINDS))

    def test_each_kind_s_rows_validate_against_its_schema(self) -> None:
        mapping = self.schema["components"]["schemas"]["ExamReportRow"]["discriminator"]["mapping"]
        for kind in reports.REPORT_KINDS:
            with self.subTest(kind=kind):
                name = mapping[kind].rsplit("/", 1)[-1]
                schema = self.component(name)
                rows = self.rows(kind)
                self.assertTrue(rows, f"{kind} needs rows to prove anything")
                # Draft 4, whose boolean `exclusiveMaximum` OpenAPI 3.0 also uses.
                validator = jsonschema.Draft4Validator(schema)
                for row in rows:
                    validator.validate(row)
                    self.assertEqual(row["kind"], kind)
                    # No field the schema leaves out, and none it promises missing.
                    self.assertEqual(set(row), set(schema["properties"]))

    def test_each_serializer_mirrors_its_report_function(self) -> None:
        """A key the report builds but the serializer drops would vanish silently."""
        from apps.examinations import services

        for kind in reports.REPORT_KINDS:
            with self.subTest(kind=kind), tenant_context(self.tenant.id):
                built = services.build_report_rows(kind=kind, exam_id=self.exam.pk, user=self.user)
                fields = set(REPORT_ROW_SERIALIZERS[kind]().fields) - {"kind"}
                for row in built:
                    self.assertEqual(set(row), fields)

    def test_decimals_stay_json_numbers(self) -> None:
        """As the inline report sent them before rows were typed."""
        (row, *_) = self.rows("result-register")

        self.assertIsInstance(row["percentage"], float)


class ReportAverageAgreementTests(ProcessingTestCase):
    """An average that does not terminate is rounded once, in `reports.py`, so the
    inline row and the exported file carry the same figure."""

    def setUp(self) -> None:
        super().setUp()
        self.mark_all("70.00", "70.00", "71.00")  # mean 70.333...
        self.process()

    def exported(self, kind: str, column: str) -> str:
        from apps.examinations import services
        from core.exports import tabular

        # What `export_exam_report_task` renders: the same builder, then the CSV writer.
        with tenant_context(self.tenant.id):
            rows = services.build_report_rows(kind=kind, exam_id=self.exam.pk, user=self.user)
        data, _mime, _ext = tabular.render(rows, fmt="csv", title=kind)
        (record,) = csv.DictReader(io.StringIO(data.decode("utf-8-sig")))
        return record[column]

    def test_inline_and_export_agree_on_an_average(self) -> None:
        cases = {
            "pass-fail-analysis": "average_percentage",
            "subject-performance": "average_marks",
        }
        for kind, column in cases.items():
            with self.subTest(kind=kind):
                response = self.client.get(SUMMARY, {"kind": kind, "exam_id": str(self.exam.pk)})
                (row,) = response.json()["data"]

                self.assertEqual(row[column], 70.33)
                self.assertEqual(Decimal(self.exported(kind, column)), Decimal("70.33"))
