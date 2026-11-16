import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { USER_LOADED, UserLoaded } from "@/test-fixtures/user-loaded";
import { pick } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { PageDirectoryTable } from "../page-directory-table";
import { PagesToolbar } from "../pages-toolbar";
import {
  asUser,
  createPage,
  deletePage,
  fetchPagesPage,
  HOME_ID,
  PAGE_ID,
  PAGE_KEYS,
  pageRecord,
  pagesPage,
  refusal,
  rowOf,
  stubPagesServices,
  urlParam,
} from "./pages-test-support";

jest.mock("next/navigation", () =>
  jest
    .requireActual<{ createNavigationMock: () => unknown }>("@/test-utils")
    .createNavigationMock(),
);

jest.mock("sonner", () => ({ toast: { success: jest.fn(), error: jest.fn() } }));

jest.mock("@/services", () =>
  jest
    .requireActual<{ pagesServicesMock: () => unknown }>("./pages-services-mock")
    .pagesServicesMock(),
);

const home = pageRecord({
  id: HOME_ID,
  title: "Home",
  slug: "home",
  page_type: "home",
  status: "published",
});

async function renderScreen() {
  renderWithProviders(
    <>
      <UserLoaded />
      <PagesToolbar />
      <PageDirectoryTable />
    </>,
  );
  await screen.findByText(USER_LOADED);
  return userEvent.setup();
}

describe("pages directory", () => {
  beforeEach(() => {
    stubPagesServices();
    fetchPagesPage.mockResolvedValue(pagesPage([home, pageRecord()]));
  });

  it("lists each page with its address, type and status, its title opening the editor", async () => {
    await renderScreen();

    await screen.findByText("Admissions 2027");
    const homeRow = rowOf("Home");
    // The home page is served at the site's root, whatever its slug.
    expect(homeRow.getByText("/")).toBeInTheDocument();
    expect(homeRow.getByText("Home page")).toBeInTheDocument();
    expect(homeRow.getByText("Published")).toBeInTheDocument();
    const draft = rowOf("Admissions 2027");
    expect(draft.getByText("/admissions-2027")).toBeInTheDocument();
    expect(draft.getByText("Standard page")).toBeInTheDocument();
    expect(draft.getByRole("link", { name: "Admissions 2027" })).toHaveAttribute(
      "href",
      `/website/pages/${PAGE_ID}`,
    );
  });

  it("reads its filters, sort and page from the URL", async () => {
    stubPagesServices("/website/pages?status=draft&type=about&sort=-updated_at&page=2&search=adm");
    fetchPagesPage.mockResolvedValue(pagesPage([pageRecord()]));
    await renderScreen();

    await waitFor(() => {
      expect(fetchPagesPage).toHaveBeenCalledWith(
        expect.objectContaining({
          page: 2,
          search: "adm",
          ordering: "-updated_at",
          status: "draft",
          pageType: "about",
        }),
      );
    });
  });

  it("drops a filter value it doesn't know", async () => {
    stubPagesServices("/website/pages?status=deleted&type=blog");
    await renderScreen();

    await waitFor(() => {
      expect(fetchPagesPage).toHaveBeenCalledWith(
        expect.objectContaining({ status: undefined, pageType: undefined, ordering: "slug" }),
      );
    });
  });

  it("filters by status and type through the URL", async () => {
    const user = await renderScreen();
    await screen.findByText("Admissions 2027");

    await pick(user, "Status", "Draft");
    await waitFor(() => {
      expect(urlParam("status")).toBe("draft");
    });
    await pick(user, "Page type", "Admissions");
    await waitFor(() => {
      expect(urlParam("type")).toBe("admissions");
    });
    expect(fetchPagesPage).toHaveBeenLastCalledWith(
      expect.objectContaining({ status: "draft", pageType: "admissions" }),
    );

    // A header click sorts by it (and opens its menu, closed again).
    await user.click(screen.getByRole("button", { name: "Title" }));
    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(urlParam("sort")).toBe("title");
    });
  });

  it("offers Delete only where the API could allow it", async () => {
    asUser(...PAGE_KEYS);
    await renderScreen();
    await screen.findByText("Admissions 2027");

    expect(screen.queryByRole("button", { name: "Delete Home" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete Admissions 2027" })).toBeInTheDocument();
  });

  it("shows a refused delete's reason, translated, and keeps the dialog open", async () => {
    asUser(...PAGE_KEYS);
    deletePage.mockRejectedValue(
      refusal([
        {
          field: "page",
          issue:
            "page_in_use: this page cannot be removed because it is linked from the header menu.",
        },
      ]),
    );
    const user = await renderScreen();
    await user.click(await screen.findByRole("button", { name: "Delete Admissions 2027" }));

    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Delete page" }));

    expect(
      await within(dialog).findByText(
        "This page can't be removed: it is the home page, or a menu links to it. Take it out of the menus first.",
      ),
    ).toBeInTheDocument();
    expect(deletePage).toHaveBeenCalledWith(PAGE_ID);
  });

  it("offers no write to a viewer holding only the view key", async () => {
    await renderScreen();
    await screen.findByText("Admissions 2027");

    expect(screen.queryByRole("button", { name: "New page" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Delete / })).not.toBeInTheDocument();
  });

  it("creates a page, never offering the home type, then opens its editor", async () => {
    asUser(...PAGE_KEYS);
    createPage.mockResolvedValue({ ...pageRecord(), sections: [] });
    const user = await renderScreen();

    await user.click(screen.getByRole("button", { name: "New page" }));
    const dialog = await screen.findByRole("dialog", { name: "New page" });
    await user.type(within(dialog).getByLabelText("Title"), "Admissions 2027");
    await user.type(within(dialog).getByLabelText("Address"), "admissions-2027");
    await user.click(within(dialog).getByRole("combobox", { name: "Page type" }));
    expect(screen.queryByRole("option", { name: "Home page" })).not.toBeInTheDocument();
    await user.click(await screen.findByRole("option", { name: "Admissions" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(createPage).toHaveBeenCalledWith({
        title: "Admissions 2027",
        slug: "admissions-2027",
        page_type: "admissions",
        show_in_search: true,
      });
    });
  });

  it("refuses the home page's address before asking the API", async () => {
    asUser(...PAGE_KEYS);
    const user = await renderScreen();

    await user.click(screen.getByRole("button", { name: "New page" }));
    const dialog = await screen.findByRole("dialog", { name: "New page" });
    await user.type(within(dialog).getByLabelText("Title"), "Welcome");
    await user.type(within(dialog).getByLabelText("Address"), "home");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText("This address is reserved for the website. Choose another."),
    ).toBeInTheDocument();
    expect(createPage).not.toHaveBeenCalled();
  });

  it("shows the server's reserved-address refusal under the address", async () => {
    asUser(...PAGE_KEYS);
    createPage.mockRejectedValue(
      refusal([{ field: "slug", issue: "reserved_slug: this address is reserved." }]),
    );
    const user = await renderScreen();

    await user.click(screen.getByRole("button", { name: "New page" }));
    const dialog = await screen.findByRole("dialog", { name: "New page" });
    await user.type(within(dialog).getByLabelText("Title"), "News");
    await user.type(within(dialog).getByLabelText("Address"), "news");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const address = within(dialog).getByLabelText("Address");
    await waitFor(() => {
      expect(address).toHaveAccessibleDescription(
        expect.stringContaining("This address is reserved for the website. Choose another."),
      );
    });
  });
});
