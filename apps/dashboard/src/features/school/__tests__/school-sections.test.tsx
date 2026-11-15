import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";

import { filterMenuByAccess } from "@/app/(app)/shell/menu-access";
import { ModuleLanding } from "@/components/module-sections/module-landing";
import { ModuleSectionNav } from "@/components/module-sections/module-section-nav";
import { MENU_SIDEBAR } from "@/config/menu-config";
import { Services } from "@/services";
import { buildUser, renderWithProviders } from "@/test-utils";

import { SCHOOL_SECTIONS } from "../school-sections";

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
jest.mock("next/navigation", () => ({
  useRouter: () => mockRouter,
  usePathname: () => "/school/campuses",
}));

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn() } },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

const SETTINGS_UPDATE: PermissionKey = "school.settings.update";
const CAMPUS_UPDATE: PermissionKey = "school.campus.update";

describe("school sections", () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it("lists the sections in tab order, each on its resource's write keys", () => {
    expect(SCHOOL_SECTIONS.map((section) => [section.href, section.permission])).toEqual([
      ["/school/profile", SETTINGS_UPDATE],
      ["/school/campuses", ["school.campus.create", CAMPUS_UPDATE, "school.campus.delete"]],
      [
        "/school/sessions",
        [
          "school.academic-session.create",
          "school.academic-session.update",
          "school.academic-session.activate",
          "school.academic-session.close",
        ],
      ],
      [
        "/school/classes",
        [
          "school.class.create",
          "school.class.update",
          "school.class.delete",
          "school.section.create",
          "school.section.update",
          "school.section.delete",
        ],
      ],
      [
        "/school/subjects",
        ["school.subject.create", "school.subject.update", "school.subject.delete"],
      ],
      [
        "/school/departments",
        ["school.department.create", "school.department.update", "school.department.delete"],
      ],
      ["/school/houses", ["school.house.create", "school.house.update", "school.house.delete"]],
      ["/school/calendar", SETTINGS_UPDATE],
    ]);
  });

  it("sends a campus manager to Campuses, the first section they may open", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([CAMPUS_UPDATE]));

    renderWithProviders(<ModuleLanding sections={SCHOOL_SECTIONS} />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/school/campuses");
    });
  });

  it("draws only the permitted tabs, under the labelled nav", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser([CAMPUS_UPDATE]));

    renderWithProviders(<ModuleSectionNav sections={SCHOOL_SECTIONS} namespace="school" />);

    expect(await screen.findByRole("link", { name: "Campuses" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    expect(screen.queryByRole("link", { name: "Profile & settings" })).not.toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "School sections" })).toBeInTheDocument();
  });

  it("drops the sidebar's School group for a viewer holding only the view keys", () => {
    const viewOnly = buildUser(["school.settings.view", "school.campus.view"]);
    const configurer = buildUser([SETTINGS_UPDATE]);

    const schoolGroup = (user: ReturnType<typeof buildUser>) =>
      filterMenuByAccess(MENU_SIDEBAR, user).find((item) => item.title === "School");

    expect(schoolGroup(viewOnly)).toBeUndefined();
    expect(schoolGroup(configurer)?.children?.map((child) => child.title)).toEqual([
      "Profile & settings",
      "Calendar",
    ]);
  });
});
