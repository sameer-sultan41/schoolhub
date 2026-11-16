"""The renderer's public content feeds: news, events, galleries, teachers, departments, classes
and notices. Review Focus 1 (draft or private data leaking) and 2 (a host reaching the wrong
tenant); every response shape has an exact key-set assertion (C2's convention).
"""

from __future__ import annotations

from datetime import datetime, timedelta
from unittest import mock
from zoneinfo import ZoneInfo

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from apps.communication.models import AnnouncementStatus, NoticeStatus
from apps.communication.tests.factories import AnnouncementFactory, NoticeFactory
from apps.school_organization.tests.factories import (
    CampusFactory,
    ClassFactory,
    DepartmentFactory,
)
from apps.staff_management.models import EmploymentStatus
from apps.staff_management.tests.factories import StaffFactory
from apps.staff_management.uploads import STAFF_PHOTO
from apps.staff_management.visibility import sync_staff_photos
from apps.website_cms.constants import PUBLIC_ALBUM_ITEMS_MAX, PUBLIC_LIST_MAX
from apps.website_cms.models import (
    ContentStatus,
    GalleryAlbum,
    GalleryItem,
    MediaType,
    NewsPost,
)
from apps.website_cms.public.tests.test_views import PLATFORM, PublicAPITestCase
from apps.website_cms.tests.factories import (
    GalleryAlbumFactory,
    GalleryItemFactory,
    NewsPostFactory,
    SchoolEventFactory,
    TenantFactory,
    enable_feature,
)
from core.files.models import FileVisibility
from core.files.tests.factories import FileFactory
from core.tenancy.context import tenant_context

PUBLISHED = ContentStatus.PUBLISHED
FILE_ID = "3f1c2b8a-1111-4222-8333-444455556666"

NEWS_KEYS = {"id", "slug", "title", "excerpt", "cover_image_url", "published_at"}
NEWS_DETAIL_KEYS = NEWS_KEYS | {"body", "updated_at"}
EVENT_KEYS = {
    "id",
    "slug",
    "title",
    "starts_at",
    "ends_at",
    "is_all_day",
    "location",
    "cover_image_url",
}
EVENT_DETAIL_KEYS = EVENT_KEYS | {"description", "updated_at"}
ALBUM_KEYS = {
    "id",
    "slug",
    "title",
    "description",
    "cover_image_url",
    "published_at",
    "item_count",
}
ALBUM_DETAIL_KEYS = ALBUM_KEYS | {"items"}
ITEM_KEYS = {"id", "media_type", "image_url", "embed_url", "caption", "alt_text", "position"}
IMAGE_KEYS = {"id", "image_url", "caption", "alt_text", "album_slug", "album_title"}
TEACHER_KEYS = {"id", "full_name", "designation", "photo_url", "bio"}
DEPARTMENT_KEYS = {"id", "name", "description"}
CLASS_KEYS = {"id", "name", "level"}
NOTICE_KEYS = {"id", "kind", "title", "body", "published_at"}

LIST_ROUTES = (
    "news-posts",
    "school-events",
    "gallery-albums",
    "gallery-items",
    "teachers",
    "departments",
    "classes",
    "notices",
)
DETAIL_ROUTES = ("news-posts/x", "school-events/x", "gallery-albums/x")


class ContentTestCase(PublicAPITestCase):
    def data(self, route: str, **params):
        response = self.read(route, **params)
        self.assertEqual(response.status_code, 200, response.content)
        return response.json()["data"]

    def make_news(self, tenant=None, **kwargs):
        return self.make_in(NewsPostFactory, tenant, **kwargs)

    def make_event(self, tenant=None, **kwargs):
        return self.make_in(SchoolEventFactory, tenant, **kwargs)

    def make_album(self, tenant=None, **kwargs):
        return self.make_in(GalleryAlbumFactory, tenant, **kwargs)

    def make_item(self, album, **kwargs):
        with tenant_context(album.tenant_id):
            return GalleryItemFactory(tenant=album.tenant, gallery_album=album, **kwargs)

    def count_queries(self, route: str, **params) -> int:
        with CaptureQueriesContext(connection) as queries:
            self.assertEqual(self.read(route, **params).status_code, 200)
        return len(queries)


class NewsTests(ContentTestCase):
    def test_news_only_published_newest_first(self) -> None:
        now = timezone.now()
        old = self.make_news(status=PUBLISHED, published_at=now - timedelta(days=2))
        new = self.make_news(status=PUBLISHED, published_at=now - timedelta(days=1))
        self.make_news(status=ContentStatus.DRAFT)
        self.make_news(status=ContentStatus.ARCHIVED, published_at=now)
        deleted = self.make_news(status=PUBLISHED, published_at=now)
        with tenant_context(self.tenant.id):
            NewsPost.objects.filter(pk=deleted.pk).update(deleted_at=now)

        rows = self.data("news-posts")

        self.assertEqual([row["id"] for row in rows], [str(new.id), str(old.id)])
        self.assertEqual(set(rows[0]), NEWS_KEYS)

    def test_news_detail_by_slug_with_public_image_urls(self) -> None:
        body = {
            "blocks": [
                {"type": "paragraph", "text": "Hello"},
                {"type": "image", "file_id": FILE_ID, "alt": "Sports day"},
            ]
        }
        self.make_news(
            slug="sports-day",
            status=PUBLISHED,
            published_at=timezone.now(),
            body=body,
            cover_image_file_id=FILE_ID,
        )

        data = self.data("news-posts/sports-day")

        self.assertEqual(set(data), NEWS_DETAIL_KEYS)
        url = f"https://api.schoolhub.test/api/v1/public/files/{self.tenant.id}/{FILE_ID}"
        self.assertEqual(data["cover_image_url"], url)
        image = data["body"]["blocks"][1]
        self.assertNotIn("file_id", image)
        self.assertEqual(image["file_url"], url)

    def test_news_detail_of_draft_archived_or_unknown_404(self) -> None:
        self.make_news(slug="draft", status=ContentStatus.DRAFT)
        self.make_news(slug="archived", status=ContentStatus.ARCHIVED)
        for slug in ("draft", "archived", "nope"):
            with self.subTest(slug=slug):
                self.assertEqual(self.read(f"news-posts/{slug}").status_code, 404)

    def test_news_list_capped_and_page_size_bounded(self) -> None:
        now = timezone.now()
        for _ in range(PUBLIC_LIST_MAX + 3):
            self.make_news(status=PUBLISHED, published_at=now)
        self.assertEqual(len(self.data("news-posts")), PUBLIC_LIST_MAX)
        self.assertEqual(len(self.data("news-posts", page_size=2)), 2)
        self.assertEqual(len(self.data("news-posts", page_size=999)), PUBLIC_LIST_MAX)
        self.assertEqual(len(self.data("news-posts", page_size=0)), 1)
        self.assertEqual(len(self.data("news-posts", page_size="x")), PUBLIC_LIST_MAX)


class EventTests(ContentTestCase):
    def test_events_upcoming_default_and_past_scope(self) -> None:
        now = timezone.now()
        soon = self.make_event(status=PUBLISHED, starts_at=now + timedelta(days=1))
        later = self.make_event(status=PUBLISHED, starts_at=now + timedelta(days=5))
        running = self.make_event(
            status=PUBLISHED,
            starts_at=now - timedelta(days=1),
            ends_at=now + timedelta(hours=2),
        )
        over = self.make_event(
            status=PUBLISHED, starts_at=now - timedelta(days=3), ends_at=now - timedelta(days=2)
        )
        over_no_end = self.make_event(status=PUBLISHED, starts_at=now - timedelta(days=1))
        self.make_event(status=ContentStatus.DRAFT, starts_at=now + timedelta(days=1))

        upcoming = self.data("school-events")
        past = self.data("school-events", scope="past")

        self.assertEqual(
            [row["id"] for row in upcoming], [str(running.id), str(soon.id), str(later.id)]
        )
        self.assertEqual([row["id"] for row in past], [str(over_no_end.id), str(over.id)])
        self.assertEqual(self.data("school-events", scope="upcoming"), upcoming)
        self.assertEqual(self.data("school-events", scope="bogus"), upcoming)
        self.assertEqual(set(upcoming[0]), EVENT_KEYS)

    def test_all_day_event_is_upcoming_through_its_local_day_then_past(self) -> None:
        zone = ZoneInfo("Asia/Karachi")
        with tenant_context(self.tenant.id):
            type(self.tenant).objects.filter(pk=self.tenant.pk).update(timezone="Asia/Karachi")
        self.tenant.refresh_from_db()
        today = self.tenant.local_date()
        midnight = datetime.combine(today, datetime.min.time(), tzinfo=zone)
        today_event = self.make_event(status=PUBLISHED, is_all_day=True, starts_at=midnight)
        yesterday_event = self.make_event(
            status=PUBLISHED, is_all_day=True, starts_at=midnight - timedelta(days=1)
        )
        multi = self.make_event(
            status=PUBLISHED,
            is_all_day=True,
            starts_at=midnight - timedelta(days=2),
            ends_at=midnight,
        )

        upcoming = [row["id"] for row in self.data("school-events")]
        past = [row["id"] for row in self.data("school-events", scope="past")]

        self.assertCountEqual(upcoming, [str(today_event.id), str(multi.id)])
        self.assertEqual(past, [str(yesterday_event.id)])

    def test_all_day_event_becomes_past_the_next_local_day(self) -> None:
        with tenant_context(self.tenant.id):
            type(self.tenant).objects.filter(pk=self.tenant.pk).update(timezone="Asia/Karachi")
        self.tenant.refresh_from_db()
        tomorrow = self.tenant.local_date() + timedelta(days=1)
        midnight = datetime.combine(tomorrow, datetime.min.time(), tzinfo=ZoneInfo("Asia/Karachi"))
        event = self.make_event(status=PUBLISHED, is_all_day=True, starts_at=midnight)
        self.assertEqual([r["id"] for r in self.data("school-events")], [str(event.id)])
        # Seen from the day after: the same event, one local day later, is past.
        later = mock.patch.object(
            type(self.tenant), "local_date", return_value=tomorrow + timedelta(days=1)
        )
        with later:
            self.assertEqual(self.data("school-events"), [])
            self.assertEqual(
                [r["id"] for r in self.data("school-events", scope="past")], [str(event.id)]
            )

    def test_timed_event_with_a_past_end_is_past(self) -> None:
        now = timezone.now()
        event = self.make_event(
            status=PUBLISHED, starts_at=now - timedelta(days=2), ends_at=now - timedelta(hours=1)
        )
        self.assertEqual(self.data("school-events"), [])
        self.assertEqual(
            [row["id"] for row in self.data("school-events", scope="past")], [str(event.id)]
        )

    def test_event_page_size_bounded(self) -> None:
        now = timezone.now()
        for day in range(3):
            self.make_event(status=PUBLISHED, starts_at=now + timedelta(days=day + 1))
        self.assertEqual(len(self.data("school-events", page_size=2)), 2)
        self.assertEqual(len(self.data("school-events", page_size=0)), 1)
        self.assertEqual(len(self.data("school-events", page_size=999)), 3)

    def test_event_detail_has_description_with_public_image_urls(self) -> None:
        description = {"blocks": [{"type": "image", "file_id": FILE_ID, "alt": "Hall"}]}
        self.make_event(
            slug="open-day", status=PUBLISHED, starts_at=timezone.now(), description=description
        )

        data = self.data("school-events/open-day")

        self.assertEqual(set(data), EVENT_DETAIL_KEYS)
        image = data["description"]["blocks"][0]
        self.assertNotIn("file_id", image)
        self.assertTrue(image["file_url"].endswith(FILE_ID))

    def test_event_detail_of_archived_404(self) -> None:
        self.make_event(slug="old", status=ContentStatus.ARCHIVED)
        self.make_event(slug="wip", status=ContentStatus.DRAFT)
        self.assertEqual(self.read("school-events/old").status_code, 404)
        self.assertEqual(self.read("school-events/wip").status_code, 404)


class GalleryTests(ContentTestCase):
    def test_album_list_counts_live_items_and_hides_unpublished(self) -> None:
        album = self.make_album(slug="trip", status=PUBLISHED, cover_image_file_id=FILE_ID)
        self.make_album(slug="draft", status=ContentStatus.DRAFT)
        self.make_item(album, position=0)
        self.make_item(album, position=1)

        rows = self.data("gallery-albums")

        self.assertEqual([row["slug"] for row in rows], ["trip"])
        self.assertEqual(set(rows[0]), ALBUM_KEYS)
        self.assertEqual(rows[0]["item_count"], 2)
        self.assertTrue(rows[0]["cover_image_url"].endswith(FILE_ID))

    def test_album_detail_items_in_position_order(self) -> None:
        album = self.make_album(slug="trip", status=PUBLISHED)
        self.make_item(album, position=2, media_type=MediaType.IMAGE, file_id=FILE_ID, embed_url="")
        self.make_item(album, position=1)

        data = self.data("gallery-albums/trip")

        self.assertEqual(set(data), ALBUM_DETAIL_KEYS)
        self.assertEqual([item["position"] for item in data["items"]], [1, 2])
        self.assertEqual(set(data["items"][0]), ITEM_KEYS)
        video, image = data["items"]
        self.assertIsNone(video["image_url"])
        self.assertEqual(video["embed_url"], "https://www.youtube.com/watch?v=abc")
        self.assertTrue(image["image_url"].endswith(FILE_ID))
        self.assertIsNone(image["embed_url"])

    def test_album_detail_of_draft_or_archived_404(self) -> None:
        self.make_album(slug="draft", status=ContentStatus.DRAFT)
        self.make_album(slug="archived", status=ContentStatus.ARCHIVED)
        for slug in ("draft", "archived"):
            with self.subTest(slug=slug):
                self.assertEqual(self.read(f"gallery-albums/{slug}").status_code, 404)

    def test_album_detail_items_capped_with_total_count(self) -> None:
        album = self.make_album(slug="big", status=PUBLISHED)
        with tenant_context(self.tenant.id):
            GalleryItem.objects.bulk_create(
                GalleryItem(
                    tenant=self.tenant,
                    gallery_album=album,
                    media_type=MediaType.VIDEO_EMBED,
                    embed_url="https://www.youtube.com/watch?v=abc",
                    position=position,
                )
                for position in range(PUBLIC_ALBUM_ITEMS_MAX + 1)
            )
        data = self.data("gallery-albums/big")
        self.assertEqual(len(data["items"]), PUBLIC_ALBUM_ITEMS_MAX)
        self.assertEqual(data["item_count"], PUBLIC_ALBUM_ITEMS_MAX + 1)
        self.assertEqual(data["items"][0]["position"], 0)

    def test_soft_deleted_items_and_albums_are_never_listed(self) -> None:
        now = timezone.now()
        album = self.make_album(slug="kept", status=PUBLISHED)
        gone_album = self.make_album(slug="gone", status=PUBLISHED)
        kept = self.make_item(
            album, position=0, media_type=MediaType.IMAGE, file_id=FILE_ID, embed_url=""
        )
        deleted_item = self.make_item(
            album, position=1, media_type=MediaType.IMAGE, file_id=FILE_ID, embed_url=""
        )
        self.make_item(
            gone_album, position=0, media_type=MediaType.IMAGE, file_id=FILE_ID, embed_url=""
        )
        with tenant_context(self.tenant.id):
            GalleryItem.objects.filter(pk=deleted_item.pk).update(deleted_at=now)
            GalleryAlbum.objects.filter(pk=gone_album.pk).update(deleted_at=now)

        self.assertEqual([r["id"] for r in self.data("gallery-items")], [str(kept.id)])
        detail = self.data("gallery-albums/kept")
        self.assertEqual([i["id"] for i in detail["items"]], [str(kept.id)])
        self.assertEqual(detail["item_count"], 1)
        self.assertEqual(self.read("gallery-albums/gone").status_code, 404)
        self.assertEqual([r["slug"] for r in self.data("gallery-albums")], ["kept"])

    def test_gallery_items_page_size_bounded(self) -> None:
        album = self.make_album(slug="a", status=PUBLISHED)
        for position in range(3):
            self.make_item(
                album, position=position, media_type=MediaType.IMAGE, file_id=FILE_ID, embed_url=""
            )
        self.assertEqual(len(self.data("gallery-items", page_size=2)), 2)
        self.assertEqual(len(self.data("gallery-items", page_size=999)), 3)

    def test_gallery_items_only_from_published_albums(self) -> None:
        live = self.make_album(slug="live", status=PUBLISHED)
        hidden = self.make_album(slug="hidden", status=ContentStatus.DRAFT)
        archived = self.make_album(slug="gone", status=ContentStatus.ARCHIVED)
        shown = self.make_item(
            live, position=0, media_type=MediaType.IMAGE, file_id=FILE_ID, embed_url=""
        )
        self.make_item(live, position=1)  # a video embed: not an image
        for album in (hidden, archived):
            self.make_item(
                album, position=0, media_type=MediaType.IMAGE, file_id=FILE_ID, embed_url=""
            )

        rows = self.data("gallery-items")

        self.assertEqual([row["id"] for row in rows], [str(shown.id)])
        self.assertEqual(set(rows[0]), IMAGE_KEYS)
        self.assertEqual(rows[0]["album_slug"], "live")
        self.assertTrue(rows[0]["image_url"].endswith(FILE_ID))


class OtherModuleFeedTests(ContentTestCase):
    def setUp(self) -> None:
        super().setUp()
        with tenant_context(self.tenant.id):
            self.campus = CampusFactory(tenant=self.tenant, is_primary=True)

    def make_photo(self):
        with tenant_context(self.tenant.id):
            return FileFactory(tenant=self.tenant, purpose=STAFF_PHOTO.key, mime_type="image/png")

    def make_staff(self, **fields):
        with tenant_context(self.tenant.id):
            return StaffFactory(tenant=self.tenant, campus=self.campus, **fields)

    def test_teachers_feed_uses_public_py_and_emits_photo_url(self) -> None:
        photo = self.make_photo()
        listed = self.make_staff(
            show_on_website=True, public_bio="Hi", first_name="Ada", photo_file=photo
        )
        self.make_staff(show_on_website=False)
        self.make_staff(show_on_website=True, employment_status=EmploymentStatus.RESIGNED)
        with tenant_context(self.tenant.id):
            sync_staff_photos({photo.pk})

        rows = self.data("teachers")

        self.assertEqual([row["id"] for row in rows], [str(listed.id)])
        self.assertEqual(set(rows[0]), TEACHER_KEYS)
        self.assertEqual(rows[0]["bio"], "Hi")
        self.assertEqual(
            rows[0]["photo_url"],
            f"https://api.schoolhub.test/api/v1/public/files/{self.tenant.id}/{photo.pk}",
        )

    def test_teacher_photo_withheld_unless_the_file_is_public(self) -> None:
        photo = self.make_photo()  # never synced: still private
        self.make_staff(show_on_website=True, photo_file=photo)
        with tenant_context(self.tenant.id):
            self.assertEqual(photo.visibility, FileVisibility.PRIVATE)
        self.assertIsNone(self.data("teachers")[0]["photo_url"])

    def test_departments_and_classes_are_opted_in_only(self) -> None:
        with tenant_context(self.tenant.id):
            shown = DepartmentFactory(tenant=self.tenant, show_on_website=True, name="Science")
            DepartmentFactory(tenant=self.tenant, show_on_website=False)
            grade = ClassFactory(tenant=self.tenant, show_on_website=True, level=1)
            ClassFactory(tenant=self.tenant, show_on_website=False, level=2)

        departments = self.data("departments")
        classes = self.data("classes")

        self.assertEqual([row["id"] for row in departments], [str(shown.id)])
        self.assertEqual(set(departments[0]), DEPARTMENT_KEYS)
        self.assertEqual([row["id"] for row in classes], [str(grade.id)])
        self.assertEqual(set(classes[0]), CLASS_KEYS)

    def test_notices_are_published_opted_in_unexpired_plain_text(self) -> None:
        now = timezone.now()
        today = self.tenant.local_date()
        with tenant_context(self.tenant.id):
            shown = NoticeFactory(
                tenant=self.tenant,
                status=NoticeStatus.PUBLISHED,
                show_on_website=True,
                published_at=now,
                body="<p>Fees <b>due</b></p><script>x()</script>",
                valid_until=today,
            )
            NoticeFactory(tenant=self.tenant, status=NoticeStatus.PUBLISHED, show_on_website=False)
            NoticeFactory(
                tenant=self.tenant,
                status=NoticeStatus.PUBLISHED,
                show_on_website=True,
                published_at=now,
                valid_until=today - timedelta(days=1),
            )
            AnnouncementFactory(
                tenant=self.tenant,
                status=AnnouncementStatus.PUBLISHED,
                show_on_website=True,
                published_at=now - timedelta(hours=1),
            )
            AnnouncementFactory(tenant=self.tenant, status=AnnouncementStatus.DRAFT)

        rows = self.data("notices")

        self.assertEqual(len(rows), 2)
        self.assertEqual(rows[0]["id"], str(shown.id))
        self.assertEqual(rows[0]["kind"], "notice")
        self.assertEqual(rows[0]["body"], "Fees due")
        self.assertEqual(rows[1]["kind"], "announcement")
        self.assertEqual(set(rows[0]), NOTICE_KEYS)


class QueryCountTests(OtherModuleFeedTests):
    def test_list_queries_constant(self) -> None:
        """Each list costs the same with one row as with several."""
        now = timezone.now()
        self.make_news(status=PUBLISHED, published_at=now)
        self.make_event(status=PUBLISHED, starts_at=now + timedelta(days=1))
        album = self.make_album(slug="a", status=PUBLISHED)
        self.make_item(album, position=0, media_type=MediaType.IMAGE, file_id=FILE_ID)
        photo = self.make_photo()
        self.make_staff(show_on_website=True, photo_file=photo)
        with tenant_context(self.tenant.id):
            DepartmentFactory(tenant=self.tenant, show_on_website=True)
            ClassFactory(tenant=self.tenant, show_on_website=True)
            NoticeFactory(
                tenant=self.tenant,
                status=NoticeStatus.PUBLISHED,
                show_on_website=True,
                published_at=now,
            )
        for route in LIST_ROUTES:
            self.read(route)  # warm the feature-flag cache
        before = {route: self.count_queries(route) for route in LIST_ROUTES}

        for index in range(5):
            self.make_news(status=PUBLISHED, published_at=now)
            self.make_event(status=PUBLISHED, starts_at=now + timedelta(days=2))
            extra = self.make_album(status=PUBLISHED)
            self.make_item(extra, position=0, media_type=MediaType.IMAGE, file_id=FILE_ID)
            self.make_staff(
                show_on_website=True, photo_file=self.make_photo(), first_name=f"T{index}"
            )
            with tenant_context(self.tenant.id):
                DepartmentFactory(tenant=self.tenant, show_on_website=True)
                ClassFactory(tenant=self.tenant, show_on_website=True)
                NoticeFactory(
                    tenant=self.tenant,
                    status=NoticeStatus.PUBLISHED,
                    show_on_website=True,
                    published_at=now,
                )

        after = {route: self.count_queries(route) for route in LIST_ROUTES}
        self.assertEqual(before, after)

    def test_detail_queries_do_not_grow_with_items(self) -> None:
        small = self.make_album(slug="small", status=PUBLISHED)
        large = self.make_album(slug="large", status=PUBLISHED)
        self.make_item(small, position=0)
        for position in range(6):
            self.make_item(large, position=position)
        self.read("gallery-albums/small")
        self.assertEqual(
            self.count_queries("gallery-albums/small"), self.count_queries("gallery-albums/large")
        )


class ContentWrongHostTests(ContentTestCase):
    def test_wrong_host_never_returns_other_tenant_content(self) -> None:
        rival = TenantFactory(slug="rival")
        enable_feature(rival, "module.website")
        self.make_site(rival, is_published=True)
        now = timezone.now()
        self.make_news(rival, slug="theirs", status=PUBLISHED, published_at=now)
        self.make_event(rival, slug="theirs", status=PUBLISHED, starts_at=now)
        self.make_album(rival, slug="theirs", status=PUBLISHED)

        for route in ("news-posts", "school-events", "gallery-albums"):
            self.assertEqual(self.data(route), [], route)
        for route in ("news-posts", "school-events", "gallery-albums"):
            self.assertEqual(self.read(f"{route}/theirs").status_code, 404, route)
        self.assertEqual(self.data("gallery-items"), [])
        for host in (f"nobody.{PLATFORM}", f"www.greenfield.{PLATFORM}", PLATFORM, ""):
            for route in (*LIST_ROUTES, *DETAIL_ROUTES):
                with self.subTest(host=host, route=route):
                    self.assertEqual(self.read(route, host=host).status_code, 404)

    def test_unpublished_site_or_module_off_404(self) -> None:
        self.make_news(slug="a", status=PUBLISHED, published_at=timezone.now())
        self.update_site(is_published=False)
        for route in (*LIST_ROUTES, "news-posts/a"):
            with self.subTest(route=route):
                self.assertEqual(self.read(route).status_code, 404)
