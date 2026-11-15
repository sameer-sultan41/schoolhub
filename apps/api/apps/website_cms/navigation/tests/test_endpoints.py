"""Endpoint tests for `/navigation-menus`."""

from __future__ import annotations

from unittest import mock

from apps.website_cms.models import ContentStatus, NavigationMenu
from apps.website_cms.tests.base import WebsiteAPITestCase
from apps.website_cms.tests.factories import NavigationMenuFactory
from core.tenancy.context import tenant_context

LIST_URL = "/api/v1/navigation-menus"


def _url(location: str = "header") -> str:
    return f"{LIST_URL}/{location}"


def _page_item(page, **extra) -> dict:
    return {"label": "About", "target_type": "page", "target": str(page.id), **extra}


class NavigationMenuReadTests(WebsiteAPITestCase):
    def test_read_requires_the_page_view_key(self) -> None:
        self.assertEqual(self.client.get(LIST_URL).status_code, 403)

    def test_get_returns_all_three_locations_empty_and_writes_nothing(self) -> None:
        self.allow("website.page.view")
        data = self.client.get(LIST_URL).json()["data"]
        self.assertEqual(
            [m["location"] for m in data], ["header", "footer_primary", "footer_secondary"]
        )
        self.assertTrue(all(m["items"] == [] for m in data))
        with tenant_context(self.tenant.id):
            self.assertEqual(NavigationMenu.objects.count(), 0)

    def test_get_returns_stored_items(self) -> None:
        self.allow("website.page.view")
        with tenant_context(self.tenant.id):
            NavigationMenuFactory(
                tenant=self.tenant,
                items=[{"label": "News", "target_type": "news_index", "children": []}],
            )
        data = self.client.get(LIST_URL).json()["data"]
        self.assertEqual(data[0]["items"][0]["label"], "News")


class NavigationMenuUpdateTests(WebsiteAPITestCase):
    def setUp(self) -> None:
        super().setUp()
        self.allow("website.page.view")

    def _patch(self, items, location: str = "header"):
        return self.client.patch(_url(location), {"items": items}, format="json")

    def test_patch_requires_the_navigation_update_key(self) -> None:
        self.assertEqual(self._patch([]).status_code, 403)

    def test_first_patch_creates_the_row_and_queues_revalidation(self) -> None:
        self.allow("website.navigation.update")
        page = self.make_page(status=ContentStatus.PUBLISHED)
        items = [
            _page_item(page, children=[{"label": "Docs", "target_type": "url", "target": "/docs"}]),
            {"label": "News", "target_type": "news_index"},
        ]
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self._patch(items)
        self.assertEqual(response.status_code, 200)
        saved = response.json()["data"]["items"]
        self.assertEqual(saved[0]["children"][0]["target"], "/docs")
        self.assertEqual(saved[1]["children"], [])
        task.delay.assert_called_once_with(str(self.tenant.id), [])
        with tenant_context(self.tenant.id):
            self.assertEqual(NavigationMenu.objects.get().location, "header")

    def test_unchanged_patch_queues_nothing(self) -> None:
        self.allow("website.navigation.update")
        self._patch([{"label": "News", "target_type": "news_index"}])
        with (
            mock.patch("apps.website_cms.revalidation.revalidate_website") as task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            self._patch([{"label": "News", "target_type": "news_index"}])
        task.delay.assert_not_called()

    def test_unknown_location_is_404(self) -> None:
        self.allow("website.navigation.update")
        self.assertEqual(self._patch([], "sidebar").status_code, 404)

    def test_menu_rejects_unpublished_page_target(self) -> None:
        self.allow("website.navigation.update")
        draft = self.make_page(status=ContentStatus.DRAFT)
        response = self._patch([{"label": "Ok", "target_type": "news_index"}, _page_item(draft)])
        self.assertEqual(response.status_code, 422)
        body = response.json()
        self.assertIn("items.1.target", str(body))
        self.assertIn("invalid_target", str(body))

    def test_menu_rejects_javascript_url(self) -> None:
        self.allow("website.navigation.update")
        bad = {"label": "X", "target_type": "url", "target": "javascript:alert(1)"}
        response = self._patch([bad])
        self.assertEqual(response.status_code, 422)
        self.assertIn("items.0.target", str(response.json()))

    def test_unsafe_child_url_is_keyed_to_the_child_path(self) -> None:
        self.allow("website.navigation.update")
        bad = {"label": "X", "target_type": "url", "target": "http://insecure.example"}
        response = self._patch([{"label": "P", "target_type": "news_index", "children": [bad]}])
        self.assertEqual(response.status_code, 422)
        self.assertIn("items.0.children.0.target", str(response.json()))

    def test_menu_depth_limit(self) -> None:
        self.allow("website.navigation.update")
        grandchild = {"label": "C", "target_type": "news_index"}
        child = {"label": "B", "target_type": "news_index", "children": [grandchild]}
        response = self._patch([{"label": "A", "target_type": "news_index", "children": [child]}])
        self.assertEqual(response.status_code, 422)
        self.assertIn("depth_exceeded", str(response.json()))

    def test_item_count_limit(self) -> None:
        self.allow("website.navigation.update")
        items = [{"label": f"L{i}", "target_type": "news_index"} for i in range(51)]
        response = self._patch(items)
        self.assertEqual(response.status_code, 422)
        self.assertIn("too_many_items", str(response.json()))

    def test_fifty_items_across_levels_are_accepted(self) -> None:
        self.allow("website.navigation.update")
        kids = [{"label": f"K{i}", "target_type": "news_index"} for i in range(24)]
        items = [
            {"label": f"P{i}", "target_type": "news_index", "children": kids} for i in range(2)
        ]
        self.assertEqual(self._patch(items).status_code, 200)

    def test_label_length_is_bounded(self) -> None:
        self.allow("website.navigation.update")
        too_long = self._patch([{"label": "x" * 61, "target_type": "news_index"}])
        self.assertEqual(too_long.status_code, 400)
        blank = self._patch([{"label": "   ", "target_type": "news_index"}])
        self.assertEqual(blank.status_code, 422)

    def test_index_target_takes_no_target(self) -> None:
        self.allow("website.navigation.update")
        response = self._patch([{"label": "N", "target_type": "news_index", "target": "x"}])
        self.assertEqual(response.status_code, 422)

    def test_unpublishing_a_nav_target_keeps_menu_but_public_drops_it(self) -> None:
        # The public half (target dropped from `GET site`) is asserted with the public API in C2.
        self.allow("website.navigation.update", "website.page.publish")
        page = self.make_page(status=ContentStatus.PUBLISHED)
        self.assertEqual(self._patch([_page_item(page)]).status_code, 200)
        self.make_section(page)
        with self.captureOnCommitCallbacks(execute=False):
            response = self.client.post(f"/api/v1/website-pages/{page.id}:unpublish")
        self.assertEqual(response.status_code, 200)
        items = self.client.get(LIST_URL).json()["data"][0]["items"]
        self.assertEqual(items[0]["target"], str(page.id))

    def test_a_menu_target_page_cannot_be_archived(self) -> None:
        self.allow("website.navigation.update", "website.page.publish")
        page = self.make_page(status=ContentStatus.PUBLISHED)
        self._patch([_page_item(page)])
        response = self.client.post(f"/api/v1/website-pages/{page.id}:archive")
        self.assertEqual(response.status_code, 422)
        self.assertIn("page_in_use", str(response.json()))
