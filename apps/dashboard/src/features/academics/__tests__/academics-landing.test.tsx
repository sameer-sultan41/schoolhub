import type { PermissionKey } from "@schoolhub/types";
import { screen, waitFor } from "@testing-library/react";

import { Services } from "@/services";
import { buildUser, renderWithProviders } from "@/test-utils";

import { AcademicsLanding } from "../academics-landing";
import { ACADEMICS_SECTIONS } from "../academics-sections";

const mockReplace = jest.fn();
const mockRouter = { replace: mockReplace };
jest.mock("next/navigation", () => ({ useRouter: () => mockRouter }));

jest.mock("@/services", () => ({
  Services: { auth: { fetchCurrentUser: jest.fn() } },
}));

const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

const ALL_SECTION_KEYS: PermissionKey[] = ACADEMICS_SECTIONS.map((section) => section.permission);

describe("AcademicsLanding", () => {
  beforeEach(() => {
    mockReplace.mockReset();
  });

  it("sends a user to the first section whose view key they hold", async () => {
    // Every section's key, so the first one in tab order is the destination.
    mockFetchCurrentUser.mockResolvedValue(buildUser(ALL_SECTION_KEYS));

    renderWithProviders(<AcademicsLanding />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/academics/curriculum");
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("sends a user who can open only a later section there, not to the first one", async () => {
    mockFetchCurrentUser.mockResolvedValue(buildUser(["academics.teacher-allocation.view"]));

    renderWithProviders(<AcademicsLanding />);

    await waitFor(() => {
      expect(mockReplace).toHaveBeenCalledWith("/academics/allocations");
    });
    expect(mockReplace).toHaveBeenCalledTimes(1);
  });

  it("shows the permission message, and goes nowhere, without any section key", async () => {
    // A key from another module, and a section's create key, neither opens a section.
    mockFetchCurrentUser.mockResolvedValue(
      buildUser(["students.student.view", "academics.curriculum.create"]),
    );

    renderWithProviders(<AcademicsLanding />);

    expect(await screen.findByText("You do not have permission to do that.")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("waits for the user, without redirecting, while permissions load", () => {
    mockFetchCurrentUser.mockReturnValue(new Promise(() => undefined));

    renderWithProviders(<AcademicsLanding />);

    expect(screen.getByText("Checking your permissions…")).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it("says the permissions could not be loaded when the user query fails", async () => {
    mockFetchCurrentUser.mockRejectedValue(new Error("down"));

    renderWithProviders(<AcademicsLanding />);

    expect(await screen.findByText(/permissions couldn't be loaded/)).toBeInTheDocument();
    expect(mockReplace).not.toHaveBeenCalled();
  });
});
