import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";

import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { sectionMenuItems } from "@/components/module-sections/module-sections";
import { MENU_SIDEBAR } from "@/config/menu-config";
import { Services } from "@/services";
import { buildUser, renderWithProviders } from "@/test-utils";

import { filterMenuByAccess } from "@/app/(app)/shell/menu-access";

import { ATTENDANCE_SECTIONS } from "../attendance-sections";

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/attendance/records",
}));

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn() } },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

const MARK: PermissionKey = "attendance.student-attendance.mark";
const VIEW: PermissionKey = "attendance.student-attendance.view";
const SETTINGS_UPDATE: PermissionKey = "school.settings.update";

describe("attendance sections", () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it("lists Register, Records and Settings, in that order, each on its §4 key", () => {
    expect(ATTENDANCE_SECTIONS.map((section) => [section.href, section.permission])).toEqual([
      ["/attendance/register", MARK],
      ["/attendance/records", VIEW],
      ["/attendance/settings", SETTINGS_UPDATE],
    ]);
  });

  it("sends a marker to the Register", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([MARK, VIEW, SETTINGS_UPDATE]));

    renderWithProviders(<ModuleLanding sections={ATTENDANCE_SECTIONS} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/attendance/register");
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("sends a viewer who cannot mark to Records, not to a Register they cannot open", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([VIEW]));

    renderWithProviders(<ModuleLanding sections={ATTENDANCE_SECTIONS} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/attendance/records");
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("sends a settings editor with no attendance key to Settings", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([SETTINGS_UPDATE]));

    renderWithProviders(<ModuleLanding sections={ATTENDANCE_SECTIONS} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/attendance/settings");
    });
  });

  it("shows a view-only user the Records tab and no Register or Settings tab", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([VIEW]));

    renderWithProviders(<ModuleSectionNav sections={ATTENDANCE_SECTIONS} namespace="attendance" />);

    expect(await screen.findByRole("link", { name: "Records" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Register" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Attendance sections" })).toBeInTheDocument();
  });

  it("gives the sidebar the same children, gated the same way", () => {
    expect(sectionMenuItems(ATTENDANCE_SECTIONS).map((item) => item.title)).toEqual([
      "Register",
      "Records",
      "Settings",
    ]);

    const attendance = filterMenuByAccess(MENU_SIDEBAR, buildUser([VIEW])).find(
      (item) => item.title === "Attendance",
    );

    expect(attendance?.children?.map((child) => child.title)).toEqual(["Records"]);
  });

  it("hides the Attendance group from a user with no attendance key", () => {
    const menu = filterMenuByAccess(MENU_SIDEBAR, buildUser(["timetable.timetable.view"]));

    expect(menu.some((item) => item.title === "Attendance")).toBe(false);
  });
});
