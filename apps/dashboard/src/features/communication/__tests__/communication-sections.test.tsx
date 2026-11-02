import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";

import { filterMenuByAccess } from "@/app/(app)/shell/menu-access";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { MENU_SIDEBAR } from "@/config/menu-config";
import { Services } from "@/services";
import { buildUser, renderWithProviders } from "@/test-utils";

import { COMMUNICATION_SECTIONS } from "../communication-sections";

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/communication/messages",
}));

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn() } },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

const VIEW: PermissionKey = "communication.thread.view";
const OVERSEE: PermissionKey = "communication.thread.oversee";
const SEND: PermissionKey = "communication.broadcast.send";

describe("communication sections", () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it("lists the three sections in tab order, each on its own key", () => {
    expect(COMMUNICATION_SECTIONS.map((section) => [section.href, section.permission])).toEqual([
      ["/communication/messages", VIEW],
      ["/communication/oversight", OVERSEE],
      ["/communication/broadcast", SEND],
    ]);
  });

  it("shows a broadcaster the Broadcast tab alone and lands them there", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([SEND]));

    renderWithProviders(
      <>
        <ModuleSectionNav sections={COMMUNICATION_SECTIONS} namespace="communication" />
        <ModuleLanding sections={COMMUNICATION_SECTIONS} />
      </>,
    );

    expect(await screen.findByRole("link", { name: "Broadcast" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Messages" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/communication/broadcast");
    });
  });

  it("sends a thread viewer to Messages", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([VIEW, OVERSEE]));

    renderWithProviders(<ModuleLanding sections={COMMUNICATION_SECTIONS} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/communication/messages");
    });
  });

  it("gives the sidebar the same children, gated the same way", () => {
    expect(sectionMenuTitles()).toEqual(["Messages", "Oversight", "Broadcast"]);

    const communication = filterMenuByAccess(MENU_SIDEBAR, buildUser([OVERSEE])).find(
      (item) => item.title === "Communication",
    );

    expect(communication?.children?.map((child) => child.title)).toEqual(["Oversight"]);
  });

  it("hides the Communication group from a user with no communication key", () => {
    const menu = filterMenuByAccess(MENU_SIDEBAR, buildUser(["timetable.timetable.view"]));

    expect(menu.some((item) => item.title === "Communication")).toBe(false);
  });
});

function sectionMenuTitles() {
  return COMMUNICATION_SECTIONS.map((section) => section.menuTitle);
}
