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
const IMPORT: PermissionKey = "attendance.student-attendance.import";
const SETTINGS_UPDATE: PermissionKey = "school.settings.update";
const CORRECTION_CREATE: PermissionKey = "attendance.correction.create";
const CORRECTION_APPROVE: PermissionKey = "attendance.correction.approve";
const LEAVE_VIEW: PermissionKey = "attendance.leave-request.view";
const STAFF_VIEW: PermissionKey = "attendance.staff-attendance.view";
const REPORT_VIEW: PermissionKey = "attendance.report.view";

describe("attendance sections", () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it("lists the seven sections in tab order, each on its §4 key", () => {
    expect(ATTENDANCE_SECTIONS.map((section) => [section.href, section.permission])).toEqual([
      ["/attendance/register", MARK],
      ["/attendance/records", [VIEW, IMPORT]],
      ["/attendance/corrections", [CORRECTION_CREATE, CORRECTION_APPROVE]],
      ["/attendance/leave", LEAVE_VIEW],
      ["/attendance/staff", STAFF_VIEW],
      ["/attendance/reports", REPORT_VIEW],
      ["/attendance/settings", SETTINGS_UPDATE],
    ]);
  });

  it.each([CORRECTION_CREATE, CORRECTION_APPROVE])(
    "shows the Corrections tab to a holder of %s alone",
    async (key) => {
      mockFetchCurrentUser.mockResolvedValue(buildUser([key]));

      renderWithProviders(
        <ModuleSectionNav sections={ATTENDANCE_SECTIONS} namespace="attendance" />,
      );

      expect(await screen.findByRole("link", { name: "Corrections" })).toBeInTheDocument();
      expect(screen.queryByRole("link", { name: "Records" })).not.toBeInTheDocument();
    },
  );

  it("shows the Leave tab to a holder of leave-request.view alone", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([LEAVE_VIEW]));

    renderWithProviders(<ModuleSectionNav sections={ATTENDANCE_SECTIONS} namespace="attendance" />);

    expect(await screen.findByRole("link", { name: "Leave" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Corrections" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Records" })).not.toBeInTheDocument();
  });

  it("shows a staff member holding only staff-attendance.view the Staff tab alone", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([STAFF_VIEW]));

    renderWithProviders(<ModuleSectionNav sections={ATTENDANCE_SECTIONS} namespace="attendance" />);

    expect(await screen.findByRole("link", { name: "Staff" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Records" })).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Register" })).not.toBeInTheDocument();
  });

  it("shows a holder of report.view alone the Reports tab, and lands them there", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([REPORT_VIEW]));

    renderWithProviders(
      <>
        <ModuleSectionNav sections={ATTENDANCE_SECTIONS} namespace="attendance" />
        <ModuleLanding sections={ATTENDANCE_SECTIONS} />
      </>,
    );

    expect(await screen.findByRole("link", { name: "Reports" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Records" })).not.toBeInTheDocument();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/attendance/reports");
    });
  });

  it("sends a staff member with no other attendance key to their Staff history", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([STAFF_VIEW]));

    renderWithProviders(<ModuleLanding sections={ATTENDANCE_SECTIONS} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/attendance/staff");
    });
  });

  it("sends a leave reviewer with no other attendance key to Leave", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([LEAVE_VIEW]));

    renderWithProviders(<ModuleLanding sections={ATTENDANCE_SECTIONS} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/attendance/leave");
    });
  });

  it("sends an approver with no other attendance key to Corrections", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([CORRECTION_APPROVE]));

    renderWithProviders(<ModuleLanding sections={ATTENDANCE_SECTIONS} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/attendance/corrections");
    });
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

  it("sends an importer with no other attendance key to Records, in tabs and sidebar", async () => {
    // `it_admin`'s default grant: Import lives on Records, without the view key (§4).
    mockFetchCurrentUser.mockResolvedValue(buildUser([IMPORT]));

    renderWithProviders(
      <>
        <ModuleSectionNav sections={ATTENDANCE_SECTIONS} namespace="attendance" />
        <ModuleLanding sections={ATTENDANCE_SECTIONS} />
      </>,
    );

    expect(await screen.findByRole("link", { name: "Records" })).toBeInTheDocument();
    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/attendance/records");
    });
    const attendance = filterMenuByAccess(MENU_SIDEBAR, buildUser([IMPORT])).find(
      (item) => item.title === "Attendance",
    );
    expect(attendance?.children?.map((child) => child.title)).toEqual(["Records"]);
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
      "Corrections",
      "Leave",
      "Staff",
      "Reports",
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
