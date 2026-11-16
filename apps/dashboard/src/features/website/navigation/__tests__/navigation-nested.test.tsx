import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services, type NavigationMenuRecord, type NavItem } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { buildUser, renderWithProviders } from "@/test-utils";

import { STAMP } from "@/features/website/shared/__tests__/content-fixtures";
import { NavigationEditor } from "../navigation-editor";

/**
 * Each link's sub-links are their own field array, rendered under the link's row. These cases
 * move and remove the top-level links around them, then save: the payload must keep every
 * sub-link with its own parent.
 */

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

const updateMenu = mocked(Services.navigationMenus.updateNavigationMenu);

const sub = (label: string, target: string): NavItem => ({
  label,
  target_type: "url",
  target,
  children: [],
});
const HISTORY = sub("History", "/about/history");
const STAFF = sub("Staff", "/about/staff");
const ABOUT: NavItem = {
  label: "About",
  target_type: "url",
  target: "/about",
  children: [HISTORY, STAFF],
};
const NEWS: NavItem = { label: "News", target_type: "news_index", target: null, children: [] };
const HOME: NavItem = { label: "Home", target_type: "url", target: "/", children: [] };

function menus(header: NavItem[]): NavigationMenuRecord[] {
  return [
    { location: "header", items: header, updated_at: STAMP },
    { location: "footer_primary", items: [], updated_at: STAMP },
    { location: "footer_secondary", items: [], updated_at: STAMP },
  ];
}

async function renderEditor(header: NavItem[]) {
  mocked(Services.navigationMenus.fetchNavigationMenus).mockResolvedValue(menus(header));
  renderWithProviders(<NavigationEditor />);
  await screen.findByRole("tab", { name: "Header" });
  return userEvent.setup();
}

function header() {
  return within(screen.getByRole("tabpanel", { name: "Header" }));
}

/** The labels of a link's sub-links, in the order shown. */
function subLabels(linkName: string): string[] {
  const row = header().getByRole("listitem", { name: linkName });
  return within(row)
    .queryAllByRole("listitem")
    .map((item) => within(item).getByRole("textbox", { name: "Label" }))
    .map((input) => (input as HTMLInputElement).value);
}

async function save(user: ReturnType<typeof userEvent.setup>) {
  await user.click(header().getByRole("button", { name: "Save menu" }));
  await waitFor(() => {
    expect(updateMenu).toHaveBeenCalledTimes(1);
  });
  return updateMenu.mock.calls[0]?.[1];
}

beforeEach(() => {
  jest.clearAllMocks();
  mocked(Services.auth.fetchCurrentUser).mockResolvedValue(
    buildUser(["website.page.view", "website.navigation.update"]),
  );
  mocked(Services.websitePages.fetchPublishedWebsitePages).mockResolvedValue([]);
  updateMenu.mockImplementation((location, items) =>
    Promise.resolve({ location, items, updated_at: STAMP }),
  );
});

describe("navigation editor: sub-links follow their parent", () => {
  it("moves a link down with its two sub-links", async () => {
    const user = await renderEditor([ABOUT, NEWS]);

    await user.click(header().getByRole("button", { name: "Move link 1 down" }));

    expect(subLabels("Link 2: About")).toEqual(["History", "Staff"]);
    expect(subLabels("Link 1: News")).toEqual([]);
    expect(await save(user)).toEqual([NEWS, ABOUT]);
  });

  it("keeps the next link's sub-links when the link above it is removed", async () => {
    const user = await renderEditor([HOME, ABOUT]);

    await user.click(header().getByRole("button", { name: "Remove link 1" }));

    expect(subLabels("Link 1: About")).toEqual(["History", "Staff"]);
    expect(await save(user)).toEqual([ABOUT]);
  });

  it("moves a sub-link up within its parent", async () => {
    const user = await renderEditor([ABOUT, NEWS]);

    await user.click(header().getByRole("button", { name: "Move sub-link 2 of link 1 up" }));

    expect(subLabels("Link 1: About")).toEqual(["Staff", "History"]);
    expect(await save(user)).toEqual([{ ...ABOUT, children: [STAFF, HISTORY] }, NEWS]);
  });
});
