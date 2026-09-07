"""The renderer, and the import discipline it exists to centralise."""

from __future__ import annotations

import ast
import inspect

from django.test import SimpleTestCase

from core.documents import pdf


class RenderTests(SimpleTestCase):
    def test_a_document_renders_to_pdf_bytes(self) -> None:
        data = pdf.render_pdf("<html><head></head><body><p>Hello</p></body></html>")

        self.assertTrue(data.startswith(b"%PDF"))

    def test_a_page_size_is_injected_when_the_document_declares_none(self) -> None:
        data = pdf.render_pdf("<html><head></head><body>x</body></html>", page_size="A5")

        self.assertTrue(data.startswith(b"%PDF"))

    def test_a_document_with_its_own_page_rule_is_left_alone(self) -> None:
        """A landscape register sets its own margins and orientation; a second
        `@page` injected above it would silently fight the caller's layout."""
        document = (
            "<html><head><style>@page { size: A4 landscape; margin: 12mm; }</style>"
            "</head><body>x</body></html>"
        )

        self.assertNotIn("size: A4;", document)
        self.assertTrue(pdf.render_pdf(document).startswith(b"%PDF"))


class ImportDisciplineTests(SimpleTestCase):
    def test_weasyprint_is_imported_inside_the_function(self) -> None:
        """WeasyPrint links against system libraries that only api.yml's `test`
        job installs. A module-level import breaks `manage.py check --deploy`,
        which CI runs in a job without them — so this is the assertion that
        stops a future edit hoisting the import to the top of the file for
        tidiness and taking the deploy check down with it.
        """
        tree = ast.parse(inspect.getsource(pdf))
        import_nodes = (ast.Import, ast.ImportFrom)
        top_level = [node for node in tree.body if isinstance(node, import_nodes)]
        imported = {
            alias.name for node in top_level if isinstance(node, ast.Import) for alias in node.names
        } | {node.module for node in top_level if isinstance(node, ast.ImportFrom)}

        self.assertNotIn("weasyprint", imported)
        self.assertIn("from weasyprint import HTML", inspect.getsource(pdf.render_pdf))
