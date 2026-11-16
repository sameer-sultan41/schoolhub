import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { Page } from "@schoolhub/types";

import { ApiError, Services, type WebsiteContentQuery } from "@/services";
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

interface Row {
  id: string;
  title: string;
  status: "draft" | "published" | "archived";
  updated_at: string;
}

/** A content list stub: per-status totals for the count reads, `rows` (oldest first) for the
 * stale read. */
function listStub(totals: Record<string, number>, rows: Row[] = []) {
  return (query: WebsiteContentQuery = {}): Promise<Page<Row>> => {
    if (query.status) {
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
    return Promise.resolve({ items: rows });
  };
}

function card(heading: HTMLElement): HTMLElement {
  return heading.closest("[data-slot=card]") as HTMLElement;
}

function stubAll() {
  mocked(Services.websitePages.fetchWebsitePagePage).mockImplementation(
    listStub({ draft: 3, published: 5, archived: 1 }, [
      { id: "p1", title: "Old about page", status: "published", updated_at: daysAgo(400) },
      { id: "p2", title: "Fresh home", status: "published", updated_at: daysAgo(3) },
    ]) as never,
  );
  mocked(Services.newsPosts.fetchNewsPostPage).mockImplementation(
    listStub({ draft: 0, published: 12, archived: 4 }, [
      {
        id: "n1",
        title: "Sports day 2025",
        status: "archived",
        updated_at: daysAgo(STALE_AFTER_DAYS + 1),
      },
    ]) as never,
  );
  mocked(Services.schoolEvents.fetchSchoolEventPage).mockImplementation(listStub({}) as never);
  mocked(Services.galleryAlbums.fetchGalleryAlbumPage).mockImplementation(listStub({}) as never);
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
      ordering: "updated_at",
      pageSize: 10,
    });
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
      listStub({ draft: 2, published: 0, archived: 0 }) as never,
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
