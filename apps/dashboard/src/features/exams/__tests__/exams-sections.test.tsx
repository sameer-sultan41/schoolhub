import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";

import { filterMenuByAccess } from "@/app/(app)/shell/menu-access";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { MENU_SIDEBAR } from "@/config/menu-config";
import { Services } from "@/services";
import { buildUser, renderWithProviders } from "@/test-utils";

import { EXAMS_SECTIONS } from "../exams-sections";

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/exams/grading-scales",
}));

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn() } },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

const SCALE_VIEW: PermissionKey = "exams.grading-scale.view";
const EXAM_VIEW: PermissionKey = "exams.exam.view";
const RESULT_VIEW: PermissionKey = "exams.result.view";
const BANK_VIEW: PermissionKey = "exams.question-bank.view";

describe("exams sections", () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it("lists the sections in tab order, each on its key", () => {
    expect(EXAMS_SECTIONS.map((section) => [section.href, section.permission])).toEqual([
      ["/exams", EXAM_VIEW],
      ["/exams/grading-scales", SCALE_VIEW],
      ["/exams/reports", RESULT_VIEW],
      ["/exams/question-banks", BANK_VIEW],
    ]);
  });

  it("sends a viewer to the first section they may open", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([SCALE_VIEW]));

    renderWithProviders(<ModuleLanding sections={EXAMS_SECTIONS} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/exams/grading-scales");
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("sends nobody anywhere, and says so, for a viewer holding no examinations key", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser(["students.student.view"]));

    renderWithProviders(<ModuleLanding sections={EXAMS_SECTIONS} />);

    expect(await screen.findByText(/permission/i)).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("draws a tab for each section the viewer holds the key of, under the labelled nav", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([SCALE_VIEW]));

    renderWithProviders(<ModuleSectionNav sections={EXAMS_SECTIONS} namespace="exams" />);

    expect(await screen.findByRole("link", { name: "Grading scales" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Exams" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Examinations sections" })).toBeInTheDocument();
  });

  it("marks only the most specific tab as current: Exams does not light up under Grading scales", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([EXAM_VIEW, SCALE_VIEW]));

    renderWithProviders(<ModuleSectionNav sections={EXAMS_SECTIONS} namespace="exams" />);

    expect(await screen.findByRole("link", { name: "Exams" })).not.toHaveAttribute("aria-current");
    expect(screen.getByRole("link", { name: "Grading scales" })).toHaveAttribute(
      "aria-current",
      "page",
    );
  });

  it("draws the Reports tab for a holder of the result view key", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([RESULT_VIEW]));

    renderWithProviders(<ModuleSectionNav sections={EXAMS_SECTIONS} namespace="exams" />);

    expect(await screen.findByRole("link", { name: "Reports" })).toHaveAttribute(
      "href",
      "/exams/reports",
    );
  });

  it("draws the Question banks tab for a holder of the bank view key", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([BANK_VIEW]));

    renderWithProviders(<ModuleSectionNav sections={EXAMS_SECTIONS} namespace="exams" />);

    expect(await screen.findByRole("link", { name: "Question banks" })).toHaveAttribute(
      "href",
      "/exams/question-banks",
    );
  });

  it("draws no tab for a viewer without any section's key", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser(["students.student.view"]));

    renderWithProviders(<ModuleSectionNav sections={EXAMS_SECTIONS} namespace="exams" />);

    await waitFor(() => {
      expect(mockFetchCurrentUser).toHaveBeenCalled();
    });
    expect(screen.queryByRole("navigation")).not.toBeInTheDocument();
  });

  it("puts an Examinations group after Attendance, gated on the exams prefix and the section keys", () => {
    const titles = MENU_SIDEBAR.map((item) => item.title);
    // After Attendance, not necessarily adjacent: other modules may also slot in after it.
    expect(titles.indexOf("Attendance")).toBeGreaterThanOrEqual(0);
    expect(titles.indexOf("Examinations")).toBeGreaterThan(titles.indexOf("Attendance"));

    const visible = filterMenuByAccess(MENU_SIDEBAR, buildUser([SCALE_VIEW])).find(
      (item) => item.title === "Examinations",
    );
    expect(visible?.children?.map((child) => child.title)).toEqual(["Grading scales"]);

    const both = filterMenuByAccess(MENU_SIDEBAR, buildUser([EXAM_VIEW, SCALE_VIEW])).find(
      (item) => item.title === "Examinations",
    );
    expect(both?.children?.map((child) => child.title)).toEqual(["Exams", "Grading scales"]);

    const reports = filterMenuByAccess(MENU_SIDEBAR, buildUser([RESULT_VIEW])).find(
      (item) => item.title === "Examinations",
    );
    expect(reports?.children?.map((child) => child.title)).toEqual(["Reports"]);

    const banks = filterMenuByAccess(MENU_SIDEBAR, buildUser([BANK_VIEW, RESULT_VIEW])).find(
      (item) => item.title === "Examinations",
    );
    expect(banks?.children?.map((child) => child.title)).toEqual(["Reports", "Question banks"]);

    const hidden = filterMenuByAccess(MENU_SIDEBAR, buildUser(["students.student.view"])).find(
      (item) => item.title === "Examinations",
    );
    expect(hidden).toBeUndefined();
  });
});
