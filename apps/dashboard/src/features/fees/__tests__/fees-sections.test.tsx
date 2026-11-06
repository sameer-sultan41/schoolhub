import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";

import { filterMenuByAccess } from "@/app/(app)/shell/menu-access";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { permittedSections, sectionMenuItems } from "@/components/module-sections/module-sections";
import { MENU_SIDEBAR } from "@/config/menu-config";
import { Services } from "@/services";
import { buildUser, renderWithProviders } from "@/test-utils";

import { FEES_SECTIONS } from "@/features/fees/fees-sections";

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/fees/structures",
}));

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn() } },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

const STRUCTURE_VIEW: PermissionKey = "fees.fee-structure.view";
const LEDGER_VIEW: PermissionKey = "fees.ledger.view";

describe("fees sections", () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it("lists Structures then Ledger, each on its own view key", () => {
    expect(FEES_SECTIONS.map((section) => [section.href, section.permission])).toEqual([
      ["/fees/structures", STRUCTURE_VIEW],
      ["/fees/ledger", LEDGER_VIEW],
    ]);
  });

  it.each([
    [
      [STRUCTURE_VIEW, LEDGER_VIEW],
      ["/fees/structures", "/fees/ledger"],
    ],
    [[STRUCTURE_VIEW], ["/fees/structures"]],
    [[LEDGER_VIEW], ["/fees/ledger"]],
    [[], []],
  ] as const)("permits %j to open %j", (keys, hrefs) => {
    const permitted = permittedSections(FEES_SECTIONS, buildUser([...keys]));

    expect(permitted.map((section) => section.href)).toEqual(hrefs);
  });

  it.each([
    [[STRUCTURE_VIEW, LEDGER_VIEW], "/fees/structures"],
    [[STRUCTURE_VIEW], "/fees/structures"],
    [[LEDGER_VIEW], "/fees/ledger"],
  ] as const)("lands a holder of %j on %s", async (keys, href) => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([...keys]));

    renderWithProviders(<ModuleLanding sections={FEES_SECTIONS} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith(href);
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("shows a ledger viewer the Ledger tab and no Structures tab", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([LEDGER_VIEW]));

    renderWithProviders(<ModuleSectionNav sections={FEES_SECTIONS} namespace="fees" />);

    expect(await screen.findByRole("link", { name: "Ledger" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Structures" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Fees & Finance sections" })).toBeInTheDocument();
  });

  it("gives the sidebar the same children, gated the same way", () => {
    expect(sectionMenuItems(FEES_SECTIONS).map((item) => item.title)).toEqual([
      "Structures",
      "Ledger",
    ]);

    const fees = filterMenuByAccess(MENU_SIDEBAR, buildUser([LEDGER_VIEW])).find(
      (item) => item.title === "Fees & Finance",
    );

    expect(fees?.children?.map((child) => child.title)).toEqual(["Ledger"]);
  });

  it("hides the Fees & Finance group from a user with no fees key", () => {
    const menu = filterMenuByAccess(MENU_SIDEBAR, buildUser(["timetable.timetable.view"]));

    expect(menu.some((item) => item.title === "Fees & Finance")).toBe(false);
  });
});
