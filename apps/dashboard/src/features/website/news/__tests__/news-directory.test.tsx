import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";

import { Services } from "@/services";
import { mocked, rowOf, urlParam } from "@/test-fixtures/list-screen";
import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import {
  documentError,
  newsPost,
  pageOf,
  POST_ID,
  violation,
} from "@/features/website/shared/__tests__/content-fixtures";
import { NewsDirectory } from "../news-directory";
import { NewsToolbar } from "../news-toolbar";

jest.mock("next/navigation", () =>
  jest
    .requireActual<{ createNavigationMock: () => unknown }>("@/test-utils")
    .createNavigationMock(),
);

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{
      contentServicesMock: () => unknown;
    }>("../../shared/__tests__/content-services-mock")
    .contentServicesMock(),
);

const news = Services.newsPosts;
const fetchPage = mocked(news.fetchNewsPostPage);
const fetchPost = mocked(news.fetchNewsPost);
const createPost = mocked(news.createNewsPost);
const updatePost = mocked(news.updateNewsPost);
const deletePost = mocked(news.deleteNewsPost);
const publishPost = mocked(news.publishNewsPost);

/** Every news key the seeded `school_admin` holds (module doc §4). */
const EDITOR_KEYS: PermissionKey[] = [
  "website.news-post.create",
  "website.news-post.update",
  "website.news-post.delete",
  "website.news-post.publish",
];

function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
    buildUser(["website.page.view", ...keys]),
  );
}

const published = newsPost({
  id: "1d2e3f4a-5b6c-4d7e-8f9a-0b1c2d3e4f5a",
  title: "New library opens",
  slug: "new-library-opens",
  status: "published",
  published_at: "2026-10-20T08:00:00Z",
});

async function renderScreen() {
  renderWithProviders(
    <>
      <UserLoaded />
      <NewsToolbar />
      <NewsDirectory />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("news directory", () => {
  beforeEach(() => {
    jest.clearAllMocks();
    setUrl("/website/news");
    asUser();
    fetchPage.mockResolvedValue(pageOf([newsPost(), published]));
    fetchPost.mockResolvedValue(newsPost());
  });

  it("lists each post with its status and publish date", async () => {
    await renderScreen();

    expect(await screen.findByRole("table", { name: "News posts" })).toBeInTheDocument();
    expect(rowOf("Sports day results").getByText("Draft")).toBeInTheDocument();
    const library = rowOf("New library opens");
    expect(library.getByText("Published")).toBeInTheDocument();
    expect(library.getByText("October 20th, 2026")).toBeInTheDocument();
  });

  it("filters by status and searches through the URL", async () => {
    const user = await renderScreen();
    await screen.findByText("Sports day results");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Published" }));
    await waitFor(() => {
      expect(urlParam("status")).toBe("published");
    });
    expect(fetchPage).toHaveBeenLastCalledWith(expect.objectContaining({ status: "published" }));

    await user.type(screen.getByRole("textbox", { name: "Search" }), "library");
    await waitFor(() => {
      expect(fetchPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ search: "library", status: "published" }),
      );
    });
  });

  it("offers a viewer with only the read key no write, in the list or the sheet", async () => {
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Sports day results" }));
    const sheet = await screen.findByRole("dialog", { name: "Sports day results" });
    expect(await within(sheet).findByText("Blue house won.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "New post" })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Publish" })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Edit" })).not.toBeInTheDocument();
  });

  it("writes a post whose address follows the title, with no cover key", async () => {
    asUser(...EDITOR_KEYS);
    createPost.mockResolvedValue(newsPost());
    const user = await renderScreen();

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = await screen.findByRole("dialog", { name: "New post" });
    await user.type(within(dialog).getByLabelText("Title"), "Sports Day: Results!");
    expect(within(dialog).getByLabelText("Address")).toHaveValue("sports-day-results");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createPost).toHaveBeenCalledWith({
        title: "Sports Day: Results!",
        slug: "sports-day-results",
        excerpt: "",
        body: { blocks: [] },
      });
    });
  });

  it("shows a taken address under the Address field, in the viewer's words", async () => {
    asUser(...EDITOR_KEYS);
    createPost.mockRejectedValue(
      violation("slug", "slug_taken", "another item already uses this address."),
    );
    const user = await renderScreen();

    await user.click(screen.getByRole("button", { name: "New post" }));
    const dialog = await screen.findByRole("dialog", { name: "New post" });
    await user.type(within(dialog).getByLabelText("Title"), "Sports day");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("Another item already uses this address."),
    ).toBeVisible();
    expect(within(dialog).getByLabelText("Address")).toHaveAttribute("aria-invalid", "true");
  });

  it("edits a post from its detail and lands a body error under its block", async () => {
    asUser(...EDITOR_KEYS);
    updatePost.mockRejectedValue(documentError("blocks.0.text", "'' is too short"));
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Edit Sports day results" }));
    const dialog = await screen.findByRole("dialog", { name: "Edit post" });
    expect(await within(dialog).findByDisplayValue("Blue house won.")).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Address")).toHaveValue("sports-day-results");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(updatePost).toHaveBeenCalledWith(
        POST_ID,
        expect.objectContaining({ cover_image_file_id: null }),
      );
    });
    expect(await within(dialog).findByText("'' is too short")).toBeVisible();
    expect(within(dialog).getByDisplayValue("Blue house won.")).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });

  it("publishes from the sheet, and offers Delete only once the post is not published", async () => {
    asUser(...EDITOR_KEYS);
    publishPost.mockResolvedValue(newsPost({ status: "published" }));
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Sports day results" }));
    const sheet = await screen.findByRole("dialog", { name: "Sports day results" });
    await user.click(await within(sheet).findByRole("button", { name: "Publish" }));
    expect(publishPost).toHaveBeenCalledWith(POST_ID);

    fetchPost.mockResolvedValue(published);
    await user.keyboard("{Escape}");
    await user.click(screen.getByRole("button", { name: "New library opens" }));
    const publishedSheet = await screen.findByRole("dialog", { name: "New library opens" });
    expect(
      await within(publishedSheet).findByRole("button", { name: "Unpublish" }),
    ).toBeInTheDocument();
    expect(
      within(publishedSheet).queryByRole("button", { name: "Delete" }),
    ).not.toBeInTheDocument();
  });

  it("shows the server's refusal to delete a post published meanwhile", async () => {
    asUser(...EDITOR_KEYS);
    deletePost.mockRejectedValue(
      violation("status", "unpublish_first", "unpublish this post before deleting it."),
    );
    const user = await renderScreen();

    await user.click(await screen.findByRole("button", { name: "Sports day results" }));
    const sheet = await screen.findByRole("dialog", { name: "Sports day results" });
    await user.click(await within(sheet).findByRole("button", { name: "Delete" }));
    const confirm = await screen.findByRole("alertdialog");
    await user.click(within(confirm).getByRole("button", { name: "Delete" }));

    expect(
      await within(confirm).findByText("Unpublish it first: published content can't be deleted."),
    ).toBeVisible();
    expect(deletePost).toHaveBeenCalledWith(POST_ID);
  });
});
