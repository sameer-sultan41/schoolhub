import { ApiError } from "@schoolhub/api-client";
import type { AuthenticatedUser, PermissionKey } from "@schoolhub/types";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  campusRecord,
  REFERENCED,
  structurePage,
} from "@/services/modules/school-organization/__tests__/structure-fixtures";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { CampusesSection } from "../campuses-section";

jest.mock("next/navigation", () => {
  const testUtils = jest.requireActual<{ createNavigationMock: () => unknown }>("@/test-utils");
  return testUtils.createNavigationMock();
});

jest.mock("sonner", () => ({
  toast: { success: jest.fn(), error: jest.fn(), warning: jest.fn() },
}));

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    auth: { fetchCurrentUser: jest.fn() },
    schoolOrganization: {
      fetchCampusPage: jest.fn(),
      createCampus: jest.fn(),
      updateCampus: jest.fn(),
      deleteCampus: jest.fn(),
    },
  },
}));

const so = Services.schoolOrganization as jest.Mocked<typeof Services.schoolOrganization>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;

function userWith(...permissions: PermissionKey[]): AuthenticatedUser {
  return buildUser(["school.campus.view", ...permissions]);
}

function renderSection() {
  renderWithProviders(<CampusesSection />);
  return userEvent.setup();
}

describe("campuses section", () => {
  beforeEach(() => {
    setUrl("/school/campuses");
    mockFetchCurrentUser
      .mockReset()
      .mockResolvedValue(
        userWith("school.campus.create", "school.campus.update", "school.campus.delete"),
      );
    so.fetchCampusPage.mockReset().mockResolvedValue(structurePage([campusRecord()]));
    so.createCampus.mockReset();
    so.updateCampus.mockReset();
    so.deleteCampus.mockReset();
  });

  it("lists each campus with its primary flag, contact and status", async () => {
    so.fetchCampusPage.mockResolvedValue(
      structurePage([
        campusRecord(),
        campusRecord({
          id: "0f1e2d3c-4b5a-4968-8776-655443322110",
          name: "North Campus",
          code: "NORTH",
          is_primary: false,
          phone: null,
          email: null,
          is_active: false,
        }),
      ]),
    );

    renderSection();

    const north = await screen.findByRole("row", { name: /North Campus/ });
    expect(within(north).getByText("Inactive")).toBeInTheDocument();
    const main = screen.getByRole("row", { name: /Main Campus/ });
    expect(within(main).getByText("+92 21 1234567 · main@cityschool.test")).toBeInTheDocument();
    expect(within(main).getByText("Primary")).toBeInTheDocument();
    expect(so.fetchCampusPage).toHaveBeenCalledWith(
      expect.objectContaining({ page: 1, ordering: "name" }),
    );
  });

  it("adds a campus, sending blank optional fields as null", async () => {
    so.createCampus.mockResolvedValue(campusRecord());
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Add campus" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "North Campus");
    await user.type(within(dialog).getByLabelText("Code"), "NORTH");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.createCampus).toHaveBeenCalledWith({
        name: "North Campus",
        code: "NORTH",
        phone: null,
        email: null,
        timezone: null,
        is_primary: false,
        is_active: true,
      });
    });
  });

  it("shows the server's field error under its input and keeps the dialog open", async () => {
    const issue = "'Mars/Olympus' is not a valid IANA timezone.";
    so.createCampus.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: issue,
        status: 400,
        url: "/campuses",
        details: [{ field: "timezone", issue }],
      }),
    );
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Add campus" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "North");
    await user.type(within(dialog).getByLabelText("Code"), "N");
    await user.type(within(dialog).getByLabelText("Timezone"), "Mars/Olympus");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(issue)).toBeInTheDocument();
    expect(within(dialog).getByLabelText("Timezone")).toHaveAttribute("aria-invalid", "true");
  });

  it("rejects a malformed email before sending", async () => {
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Add campus" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "North");
    await user.type(within(dialog).getByLabelText("Code"), "N");
    await user.type(within(dialog).getByLabelText("Email"), "not-an-email");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(so.createCampus).not.toHaveBeenCalled();
  });

  it("deactivates a campus from its edit dialog", async () => {
    so.updateCampus.mockResolvedValue(campusRecord({ is_active: false }));
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit Main Campus" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("switch", { name: "Active" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.updateCampus).toHaveBeenCalledWith(
        campusRecord().id,
        expect.objectContaining({ code: "MAIN", is_active: false, is_primary: true }),
      );
    });
  });

  it("keeps the remove dialog open with the server's referenced message", async () => {
    so.deleteCampus.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: REFERENCED,
        status: 422,
        url: "/campuses",
        details: [{ field: "non_field", issue: REFERENCED }],
      }),
    );
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Remove Main Campus" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await within(dialog).findByText(REFERENCED)).toBeInTheDocument();
    expect(so.deleteCampus).toHaveBeenCalledWith(campusRecord().id);
  });

  it("offers neither Add nor row actions to a viewer with only the view key", async () => {
    mockFetchCurrentUser.mockResolvedValue(userWith());

    renderSection();

    expect(await screen.findByText("Main Campus")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add campus" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit Main Campus" })).not.toBeInTheDocument();
  });

  it("writes a status pick to the URL and sends it", async () => {
    const user = renderSection();

    await user.click(await screen.findByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Inactive" }));

    await waitFor(() => {
      expect(so.fetchCampusPage).toHaveBeenCalledWith(expect.objectContaining({ isActive: false }));
    });
    expect(new URLSearchParams(window.location.search).get("status")).toBe("inactive");
  });

  it("says when the list can't be loaded, and tries again", async () => {
    so.fetchCampusPage.mockRejectedValue(new Error("offline"));
    const user = renderSection();

    expect(await screen.findByText("The campuses couldn't be loaded.")).toBeInTheDocument();
    so.fetchCampusPage.mockResolvedValue(structurePage([campusRecord()]));
    await user.click(screen.getByRole("button", { name: "Try again" }));

    expect(await screen.findByText("Main Campus")).toBeInTheDocument();
  });
});
