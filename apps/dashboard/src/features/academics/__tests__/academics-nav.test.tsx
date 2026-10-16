import type { PermissionKey } from "@schoolhub/types";
import { screen, within } from "@testing-library/react";
import { usePathname } from "next/navigation";

import { useCurrentUser } from "@/hooks/use-current-user";
import { Services } from "@/services";
import { buildUser, renderWithProviders } from "@/test-utils";

import { AcademicsNav } from "../academics-nav";
import { ACADEMICS_SECTIONS } from "../academics-sections";

jest.mock("next/navigation", () => ({ usePathname: jest.fn() }));

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn() } },
}));

const mockUsePathname = usePathname as jest.MockedFunction<typeof usePathname>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

const ALL_SECTION_KEYS: PermissionKey[] = ACADEMICS_SECTIONS.map((section) => section.permission);

/** Renders once the signed-in user has loaded, so an absence assertion isn't just "too early". */
function UserLoaded() {
  const { data } = useCurrentUser();
  return data ? <p>user loaded</p> : null;
}

async function renderNav(permissions: PermissionKey[]) {
  mockFetchCurrentUser.mockResolvedValue(buildUser(permissions));
  renderWithProviders(
    <>
      <AcademicsNav />
      <UserLoaded />
    </>,
  );
  await screen.findByText("user loaded");
}

describe("AcademicsNav", () => {
  beforeEach(() => {
    mockUsePathname.mockReturnValue("/academics/curriculum");
  });

  it("renders a tab for each section whose view key the user holds", async () => {
    await renderNav(ALL_SECTION_KEYS);

    const nav = screen.getByRole("navigation", { name: "Academics sections" });
    const links = within(nav).getAllByRole("link");
    const hrefs = links.map((link) => link.getAttribute("href"));
    expect(hrefs).toEqual(ACADEMICS_SECTIONS.map((section) => section.href));
    expect(links[0]).toHaveTextContent("Curriculum");
    expect(links[0]).toHaveAttribute("href", "/academics/curriculum");
    expect(links[1]).toHaveTextContent("Teacher allocation");
    expect(links[1]).toHaveAttribute("href", "/academics/allocations");
    expect(links[2]).toHaveTextContent("Promotions");
    expect(links[2]).toHaveAttribute("href", "/academics/promotions");
  });

  it("renders only the tabs whose view key the user holds", async () => {
    await renderNav(["academics.teacher-allocation.view"]);

    const nav = screen.getByRole("navigation", { name: "Academics sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/academics/allocations"]);
  });

  it("renders the Promotions tab alone for a user holding only its view key", async () => {
    await renderNav(["academics.promotion.view"]);

    const nav = screen.getByRole("navigation", { name: "Academics sections" });
    const links = within(nav).getAllByRole("link");
    expect(links.map((link) => link.getAttribute("href"))).toEqual(["/academics/promotions"]);
    expect(links[0]).toHaveTextContent("Promotions");
  });

  it("does not show the Promotions tab for a user who can only create batches", async () => {
    // Create without view isn't enough: the tab is gated on the `.view` key.
    await renderNav(["academics.curriculum.view", "academics.promotion.create"]);

    expect(screen.getByRole("link", { name: "Curriculum" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Promotions" })).not.toBeInTheDocument();
  });

  it("renders no tab or landmark for a user holding no section's view key", async () => {
    // Create without view isn't enough: the tab is gated on the `.view` key.
    await renderNav(["academics.curriculum.create"]);

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("renders nothing while the user is still loading", () => {
    mockFetchCurrentUser.mockReturnValue(new Promise(() => undefined));

    renderWithProviders(<AcademicsNav />);

    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("marks the tab for the current page with aria-current", async () => {
    await renderNav(ALL_SECTION_KEYS);

    const tab = screen.getByRole("link", { name: "Curriculum" });
    expect(tab).toHaveAttribute("aria-current", "page");
  });

  it("keeps a section's tab current on a page nested under it", async () => {
    mockUsePathname.mockReturnValue("/academics/curriculum/some-detail");
    await renderNav(ALL_SECTION_KEYS);

    const tab = screen.getByRole("link", { name: "Curriculum" });
    expect(tab).toHaveAttribute("aria-current", "page");
  });

  it("keeps the Promotions tab current on a batch's review page", async () => {
    mockUsePathname.mockReturnValue("/academics/promotions/a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d");
    await renderNav(ALL_SECTION_KEYS);

    expect(screen.getByRole("link", { name: "Promotions" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.getByRole("link", { name: "Curriculum" })).not.toHaveAttribute("aria-current");
  });

  it("marks no tab current on a page outside every section", async () => {
    mockUsePathname.mockReturnValue("/academics");
    await renderNav(ALL_SECTION_KEYS);

    for (const link of screen.getAllByRole("link")) {
      expect(link).not.toHaveAttribute("aria-current");
    }
  });
});
