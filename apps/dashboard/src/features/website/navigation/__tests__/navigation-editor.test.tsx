import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PermissionKey } from "@schoolhub/types";
import { toast } from "sonner";

import {
  Services,
  type NavigationMenuLocation,
  type NavigationMenuRecord,
  type NavItem,
  type WebsitePageRecord,
} from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { buildUser, renderWithProviders } from "@/test-utils";

import { STAMP, violation } from "@/features/website/shared/__tests__/content-fixtures";
import { NavigationEditor } from "../navigation-editor";

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () =>
  jest
    .requireActual<{
      siteServicesMock: () => unknown;
    }>("../../shared/__tests__/site-services-mock")
    .siteServicesMock(),
);

const fetchMenus = mocked(Services.navigationMenus.fetchNavigationMenus);
const updateMenu = mocked(Services.navigationMenus.updateNavigationMenu);
const fetchPublished = mocked(Services.websitePages.fetchPublishedWebsitePages);

const ABOUT_ID = "3c9e1a2b-4d5f-4a6b-8c7d-9e0f1a2b3c4d";
const ADMISSIONS_ID = "4d0f2b3c-5e6a-4b7c-9d8e-0f1a2b3c4d5e";
/** A page a footer link kept after it was unpublished: not among the published pages. */
const UNPUBLISHED_ID = "5e1a3c4d-6f7b-4c8d-8e9f-1a2b3c4d5e6f";

function publishedPage(id: string, title: string): WebsitePageRecord {
  return {
    id,
    title,
    slug: title.toLowerCase().replace(/\s+/g, "-"),
    page_type: "standard",
    status: "published",
    published_at: STAMP,
    locale: "",
    show_in_search: true,
    created_at: STAMP,
    updated_at: STAMP,
  };
}

function menu(location: NavigationMenuLocation, items: NavItem[]): NavigationMenuRecord {
  return { location, items, updated_at: STAMP };
}

/** The header: "Home" (a path), "About" (a page, with a sub-link to the staff list) and "News"
 * (the index). */
const HEADER: NavItem[] = [
  { label: "Home", target_type: "url", target: "/", children: [] },
  {
    label: "About",
    target_type: "page",
    target: ABOUT_ID,
    children: [{ label: "Our staff", target_type: "url", target: "/staff", children: [] }],
  },
  { label: "News", target_type: "news_index", target: null, children: [] },
];

function asUser(...keys: PermissionKey[]) {
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(buildUser(keys));
}

async function renderEditor() {
  renderWithProviders(<NavigationEditor />);
  await screen.findByRole("tab", { name: "Header" });
  return userEvent.setup();
}

function panel(name: string) {
  return within(screen.getByRole("tabpanel", { name }));
}

/** Queries within one link's row of the header. */
function link(name: string) {
  return within(panel("Header").getByRole("listitem", { name }));
}

/** Queries within the form item holding `input`: its message lands there. */
function formItemOf(input: HTMLElement) {
  const item = input.closest<HTMLElement>("[data-slot='form-item']");
  if (!item) throw new Error("no form item");
  return within(item);
}

beforeEach(() => {
  jest.clearAllMocks();
  asUser("website.page.view", "website.navigation.update");
  fetchPublished.mockResolvedValue([
    publishedPage(ABOUT_ID, "About us"),
    publishedPage(ADMISSIONS_ID, "Admissions"),
  ]);
  fetchMenus.mockResolvedValue([
    menu("header", HEADER),
    menu("footer_primary", [
      { label: "Old fees", target_type: "page", target: UNPUBLISHED_ID, children: [] },
    ]),
    menu("footer_secondary", []),
  ]);
  updateMenu.mockImplementation((location, items) => Promise.resolve(menu(location, items)));
});

describe("navigation editor", () => {
  it("shows one tab per menu location", async () => {
    await renderEditor();

    expect(screen.getAllByRole("tab").map((tab) => tab.textContent)).toEqual([
      "Header",
      "Footer",
      "Footer, second row",
    ]);
    expect(panel("Header").getByDisplayValue("About")).toBeVisible();
    expect(panel("Footer, second row").getByText("This menu has no links yet.")).toBeVisible();
  });

  it("holds the two-level limit: a link with sub-links can't be nested, a sub-link has none", async () => {
    const user = await renderEditor();

    expect(
      link("Link 2: About").getByRole("button", {
        name: "Link 2 has sub-links, so it can't be nested: menus go two levels deep",
      }),
    ).toBeDisabled();
    const subLink = link("Link 2: About").getByRole("listitem", { name: "Sub-link 1 of link 2" });
    expect(within(subLink).queryByRole("button", { name: /^Nest/ })).not.toBeInTheDocument();
    expect(
      within(subLink).queryByRole("button", { name: /Add a sub-link/ }),
    ).not.toBeInTheDocument();

    // Nesting "News" under "About" makes it a sub-link; "About" now can't be nested itself.
    await user.click(
      link("Link 3: News").getByRole("button", { name: "Nest link 3 under the link above" }),
    );
    expect(
      link("Link 2: About").getByRole("listitem", { name: "Sub-link 2 of link 2" }),
    ).toBeVisible();
    await user.click(panel("Header").getByRole("button", { name: "Save menu" }));

    await waitFor(() => {
      expect(updateMenu).toHaveBeenCalledWith("header", [
        { label: "Home", target_type: "url", target: "/", children: [] },
        {
          label: "About",
          target_type: "page",
          target: ABOUT_ID,
          children: [
            { label: "Our staff", target_type: "url", target: "/staff", children: [] },
            { label: "News", target_type: "news_index", target: null, children: [] },
          ],
        },
      ]);
    });
    expect(toast.success).toHaveBeenCalledWith("Menu saved.");
  });

  it("moves a sub-link back out to the top level", async () => {
    const user = await renderEditor();

    await user.click(
      link("Link 2: About").getByRole("button", {
        name: "Move sub-link 1 of link 2 out to the top level",
      }),
    );

    // "Our staff" follows its old parent, which, with no sub-links left, may now be nested.
    expect(panel("Header").getByRole("listitem", { name: "Link 3: Our staff" })).toBeVisible();
    expect(
      link("Link 2: About").getByRole("button", { name: "Nest link 2 under the link above" }),
    ).toBeEnabled();
    expect(
      link("Link 1: Home").getByRole("button", { name: "Nest link 1 under the link above" }),
    ).toBeDisabled();
  });

  it("shows the server's refusal of an unpublished page under that link's page", async () => {
    updateMenu.mockRejectedValue(
      violation("items.1.target", "invalid_target", "choose a published page."),
    );
    const user = await renderEditor();

    await user.click(panel("Header").getByRole("button", { name: "Save menu" }));

    const page = formItemOf(link("Link 2: About").getByRole("combobox", { name: "Page" }));
    expect(await page.findByText("Choose a published page.")).toBeVisible();
  });

  it("words the same server reason by the link's type: a sub-link's unsafe address", async () => {
    updateMenu.mockRejectedValue(
      violation(
        "items.1.children.0.target",
        "invalid_target",
        "must be an https URL or a relative path.",
      ),
    );
    const user = await renderEditor();

    await user.click(panel("Header").getByRole("button", { name: "Save menu" }));

    const subLink = link("Link 2: About").getByRole("listitem", { name: "Sub-link 1 of link 2" });
    expect(
      await within(subLink).findByText(
        "Use an https:// link, or a path on this site starting with /.",
      ),
    ).toBeVisible();
  });

  it("marks a link kept to a page that is no longer published", async () => {
    const user = await renderEditor();

    await user.click(screen.getByRole("tab", { name: "Footer" }));
    const footer = panel("Footer");

    expect(footer.getByRole("combobox", { name: "Page" })).toHaveTextContent(
      "A page that is no longer published",
    );
    expect(footer.getByText(/This page isn't published any more/)).toBeVisible();
  });

  it("refuses an unsafe link and an empty label before sending", async () => {
    const user = await renderEditor();

    await user.click(panel("Header").getByRole("button", { name: "Add a link" }));
    const added = panel("Header").getByRole("listitem", { name: "Link 4: Untitled link" });
    await user.click(within(added).getByRole("combobox", { name: "Links to" }));
    await user.click(await screen.findByRole("option", { name: "A link" }));
    await user.type(within(added).getByLabelText("Link"), "javascript:alert(1)");
    await user.click(panel("Header").getByRole("button", { name: "Save menu" }));

    expect(
      await within(added).findByText(
        "Use an https:// link, or a path on this site starting with /.",
      ),
    ).toBeVisible();
    expect(within(added).getByText("This field is required.")).toBeVisible();
    expect(updateMenu).not.toHaveBeenCalled();
  });

  it("is read-only without website.navigation.update", async () => {
    asUser("website.page.view");
    await renderEditor();

    await waitFor(() => {
      expect(panel("Header").getByDisplayValue("About")).toBeDisabled();
    });
    expect(screen.queryByRole("button", { name: "Save menu" })).not.toBeInTheDocument();
  });
});
