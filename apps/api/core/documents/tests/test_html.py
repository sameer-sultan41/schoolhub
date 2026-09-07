"""Escaping, which is the whole reason this package exists.

`apps/student_management`'s ID-card renderer interpolated student names into an
f-string template with no escaping, so these cases are regressions against a
real defect rather than hypotheticals: the names below are the shapes that
actually break a card.
"""

from __future__ import annotations

import datetime

from django.test import SimpleTestCase

from core.documents import html


class TextTests(SimpleTestCase):
    def test_markup_in_a_name_is_escaped_rather_than_rendered(self) -> None:
        self.assertEqual(
            html.text("Ali <b>Khan</b> & Co"),
            "Ali &lt;b&gt;Khan&lt;/b&gt; &amp; Co",
        )

    def test_an_ampersand_in_an_ordinary_name_survives_as_an_entity(self) -> None:
        """The common case, and the one that broke a card without anyone
        suspecting escaping: `O'Brien & Sons` is a real school name."""
        self.assertEqual(html.text("O'Brien & Sons"), "O&#x27;Brien &amp; Sons")

    def test_none_renders_as_empty_not_as_the_word_none(self) -> None:
        """A nullable column with no value is a blank on a printed card. The
        word "None" on a child's report card is a defect a parent photographs."""
        self.assertEqual(html.text(None), "")

    def test_a_date_renders_iso_not_via_str(self) -> None:
        self.assertEqual(html.text(datetime.date(2026, 9, 7)), "2026-09-07")

    def test_a_time_renders_iso(self) -> None:
        self.assertEqual(html.text(datetime.time(8, 5)), "08:05:00")

    def test_a_number_is_stringified(self) -> None:
        self.assertEqual(html.text(42), "42")


class AttrTests(SimpleTestCase):
    def test_a_quote_cannot_close_the_attribute_it_sits_in(self) -> None:
        self.assertNotIn('"', html.attr('" onload="alert(1)'))

    def test_none_is_empty(self) -> None:
        self.assertEqual(html.attr(None), "")


class TableTests(SimpleTestCase):
    def test_every_cell_and_heading_is_escaped(self) -> None:
        out = html.html_table([{"name": "<script>x</script>"}], headers=["name"])
        self.assertNotIn("<script>", out)
        self.assertIn("&lt;script&gt;", out)

    def test_column_order_follows_the_first_row_not_the_alphabet(self) -> None:
        out = html.html_table([{"zebra": 1, "apple": 2}])
        self.assertLess(out.index("zebra"), out.index("apple"))

    def test_an_empty_result_says_so_rather_than_rendering_nothing(self) -> None:
        """A zero-row table and a failed render look identical on paper."""
        self.assertIn("no rows matched", html.html_table([]))

    def test_a_missing_key_is_a_blank_cell_not_a_crash(self) -> None:
        out = html.html_table([{"a": 1}, {"a": 2, "b": 3}], headers=["a", "b"])
        self.assertIn("<td></td>", out)
