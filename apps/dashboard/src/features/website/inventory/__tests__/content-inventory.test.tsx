import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Page } from "@schoolhub/types";

import {
  ApiError,
  Services,
  type GalleryAlbumRecord,
  type NewsPostRecord,
  type SchoolEventRecord,
  type WebsiteContentQuery,
  type WebsiteContentStatus,
  type WebsitePageRecord,
} from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { STALE_AFTER_DAYS } from "../inventory-constants";
import { WebsiteLanding } from "../website-landing";

jest.mock("next/navigation", () =>
  jest
    .requireActual<{ createNavigationMock: () => unknown }>("@/test-utils")
    .createNavigationMock(),
);

jest.mock("@/services", () =>
  jest
    .requireActual<{
      servicesMock: (domains: Record<string, readonly string[]>) => unknown;
    }>("@/test-fixtures/services-mock")
    .servicesMock({
      auth: ["fetchCurrentUser"],
      websitePages: ["fetchWebsitePagePage"],
      newsPosts: ["fetchNewsPostPage"],
      schoolEvents: ["fetchSchoolEventPage"],
      galleryAlbums: ["fetchGalleryAlbumPage"],
    }),
);

const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days: number) => new Date(Date.now() - days * DAY).toISOString();
const CREATED = "2024-01-01T00:00:00Z";

type Status = WebsiteContentStatus;

function pageRow(id: string, title: string, status: Status, updatedAt: string): WebsitePageRecord {
  return {
    id,
    title,
    slug: id,
    page_type: "standard",
    status,
    published_at: status === "published" ? CREATED : null,
    locale: "en",
    show_in_search: true,
    created_at: CREATED,
    updated_at: updatedAt,
  };
}

function newsRow(id: string, title: string, status: Status, updatedAt: string): NewsPostRecord {
  return {
    id,
    title,
    slug: id,
    excerpt: "",
    cover_image_file_id: null,
    status,
    published_at: status === "published" ? CREATED : null,
    locale: "en",
    created_at: CREATED,
    updated_at: updatedAt,
  };
}

/**
 * A content list stub that honours the filters the inventory sends, as the API does: a
 * status-filtered `page_size=1` read answers that status's total, any other read answers
 * `rows` (oldest first) narrowed to the status and cut to the page size.
 */
function listStub<T extends { status: Status }>(
  totals: Partial<Record<Status, number>>,
  rows: T[] = [],
) {
  return (query: WebsiteContentQuery = {}): Promise<Page<T>> => {
    if (query.status && query.pageSize === 1) {
      return Promise.resolve({
        items: [],
        pagination: {
          page: 1,
          page_size: 1,
          total_count: totals[query.status] ?? 0,
          total_pages: 1,
        },
      });
    }
    const matching = rows.filter((row) => !query.status || row.status === query.status);
    return Promise.resolve({ items: matching.slice(0, query.pageSize ?? matching.length) });
  };
}

function card(heading: HTMLElement): HTMLElement {
  return heading.closest("[data-slot=card]") as HTMLElement;
}

function stubAll() {
  mocked(Services.websitePages.fetchWebsitePagePage).mockImplementation(
    listStub({ draft: 3, published: 5, archived: 1 }, [
      pageRow("p1", "Old about page", "published", daysAgo(400)),
      pageRow("p2", "Fresh home", "published", daysAgo(3)),
    ]),
  );
  mocked(Services.newsPosts.fetchNewsPostPage).mockImplementation(
    listStub({ published: 12, archived: 4 }, [
      newsRow("n1", "Sports day 2025", "published", daysAgo(STALE_AFTER_DAYS + 1)),
    ]),
  );
  mocked(Services.schoolEvents.fetchSchoolEventPage).mockImplementation(
    listStub<SchoolEventRecord>({}),
  );
  mocked(Services.galleryAlbums.fetchGalleryAlbumPage).mockImplementation(
    listStub<GalleryAlbumRecord>({}),
  );
}

describe("WebsiteLanding", () => {
  beforeEach(() => {
    setUrl("/website");
  });

  it("counts every kind by status", async () => {
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(["website.page.view"]));
    stubAll();
    renderWithProviders(<WebsiteLanding />);

    const pages = card(await screen.findByRole("heading", { name: "Pages" }));
    await waitFor(() => {
      expect(within(pages).getByText("5")).toBeInTheDocument();
    });
    expect(within(pages).getByText("3")).toBeInTheDocument();
    expect(within(pages).getByText("1")).toBeInTheDocument();
    const news = card(screen.getByRole("heading", { name: "News posts" }));
    expect(await within(news).findByText("12")).toBeInTheDocument();
    expect(mocked(Services.websitePages.fetchWebsitePagePage)).toHaveBeenCalledWith({
      status: "draft",
      pageSize: 1,
    });
  });

  it(`flags content not updated in more than ${STALE_AFTER_DAYS} days, oldest first`, async () => {
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(["website.page.view"]));
    stubAll();
    renderWithProviders(<WebsiteLanding />);

    const stale = card(await screen.findByRole("heading", { name: "Stale content" }));
    const rows = await within(stale).findAllByRole("listitem");
    expect(rows).toHaveLength(2);
    expect(rows[0]).toHaveTextContent("Old about page");
    expect(rows[1]).toHaveTextContent("Sports day 2025");
    expect(within(stale).queryByText("Fresh home")).not.toBeInTheDocument();
    expect(mocked(Services.newsPosts.fetchNewsPostPage)).toHaveBeenCalledWith({
      status: "published",
      ordering: "updated_at",
      pageSize: 10,
    });
  });

  it("never lets old archived rows crowd an old published one out of the sample", async () => {
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(["website.page.view"]));
    stubAll();
    const archived = Array.from({ length: 12 }, (_, index) =>
      pageRow(`a${index}`, `Archived ${index}`, "archived", daysAgo(900 - index)),
    );
    mocked(Services.websitePages.fetchWebsitePagePage).mockImplementation(
      listStub({ archived: 12 }, [
        ...archived,
        pageRow("p9", "Old admissions page", "published", daysAgo(300)),
      ]),
    );
    renderWithProviders(<WebsiteLanding />);

    const stale = card(await screen.findByRole("heading", { name: "Stale content" }));
    expect(await within(stale).findByText("Old admissions page")).toBeInTheDocument();
    expect(within(stale).queryByText("Archived 0")).not.toBeInTheDocument();
    // A stale page opens in its editor.
    expect(within(stale).getByRole("link", { name: "Old admissions page" })).toHaveAttribute(
      "href",
      "/website/pages/p9",
    );
  });

  it("shows the server's own reason when the website module is off", async () => {
    const user = userEvent.setup();
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(["website.page.view"]));
    stubAll();
    const disabled = new ApiError({
      code: "module_disabled",
      message: "This module is not enabled for your school.",
      status: 403,
      url: "/website-pages",
    });
    mocked(Services.websitePages.fetchWebsitePagePage).mockRejectedValue(disabled);
    renderWithProviders(<WebsiteLanding />);

    const messages = await screen.findAllByText("This feature is not enabled for your school.");
    expect(messages.length).toBeGreaterThan(0);
    mocked(Services.websitePages.fetchWebsitePagePage).mockImplementation(
      listStub<WebsitePageRecord>({ draft: 2 }),
    );
    await user.click(screen.getAllByRole("button", { name: "Try again" })[0] as HTMLElement);
    expect(await screen.findByText("2")).toBeInTheDocument();
  });

  it("sends a viewer without website.page.view on, never reading content", async () => {
    mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
      buildUser(["website.contact-submission.view"]),
    );
    renderWithProviders(<WebsiteLanding />);

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(mocked(Services.websitePages.fetchWebsitePagePage)).not.toHaveBeenCalled();
  });
});
