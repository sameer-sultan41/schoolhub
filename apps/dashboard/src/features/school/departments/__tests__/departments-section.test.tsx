import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  departmentRecord,
  structurePage,
} from "@/services/modules/school-organization/__tests__/structure-fixtures";
import { CAMPUS_ID } from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { DepartmentsSection } from "../departments-section";

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
    dashboard: { fetchCampuses: jest.fn() },
    schoolOrganization: {
      fetchDepartmentPage: jest.fn(),
      createDepartment: jest.fn(),
      updateDepartment: jest.fn(),
      deleteDepartment: jest.fn(),
    },
  },
}));

const so = Services.schoolOrganization as jest.Mocked<typeof Services.schoolOrganization>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchCampuses = Services.dashboard.fetchCampuses as jest.MockedFunction<
  typeof Services.dashboard.fetchCampuses
>;

function renderSection() {
  renderWithProviders(<DepartmentsSection />);
  return userEvent.setup();
}

describe("departments section", () => {
  beforeEach(() => {
    setUrl("/school/departments");
    mockFetchCurrentUser
      .mockReset()
      .mockResolvedValue(
        buildUser([
          "school.department.view",
          "school.department.create",
          "school.department.update",
          "school.department.delete",
        ]),
      );
    mockFetchCampuses.mockReset().mockResolvedValue([{ id: CAMPUS_ID, name: "Main Campus" }]);
    so.fetchDepartmentPage.mockReset().mockResolvedValue(
      structurePage([
        departmentRecord(),
        departmentRecord({
          id: "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
          name: "Accounts",
          code: "ACC",
          department_type: "administrative",
          campus_id: CAMPUS_ID,
        }),
      ]),
    );
    so.createDepartment.mockReset();
    so.updateDepartment.mockReset();
    so.deleteDepartment.mockReset();
  });

  it("names each department's campus, and all campuses for one with none", async () => {
    renderSection();

    const accounts = await screen.findByRole("row", { name: /Accounts/ });
    expect(within(accounts).getByText("Administrative")).toBeInTheDocument();
    expect(await within(accounts).findByText("Main Campus")).toBeInTheDocument();
    expect(
      within(screen.getByRole("row", { name: /Science/ })).getByText("All campuses"),
    ).toBeInTheDocument();
  });

  it("sends the campus, type and status filters from the URL", async () => {
    setUrl(`/school/departments?campus=${CAMPUS_ID}&type=academic&status=active`);

    renderSection();

    await waitFor(() => {
      expect(so.fetchDepartmentPage).toHaveBeenCalledWith(
        expect.objectContaining({
          campusId: CAMPUS_ID,
          departmentType: "academic",
          isActive: true,
          ordering: "name",
        }),
      );
    });
  });

  it("adds a department for every campus, sending a null campus", async () => {
    so.createDepartment.mockResolvedValue(departmentRecord());
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Add department" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Languages");
    await user.type(within(dialog).getByLabelText("Code"), "LANG");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.createDepartment).toHaveBeenCalledWith({
        name: "Languages",
        code: "LANG",
        department_type: "academic",
        campus_id: null,
        description: null,
        is_active: true,
      });
    });
  });

  it("puts a department on one campus", async () => {
    so.updateDepartment.mockResolvedValue(departmentRecord());
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit Science" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.updateDepartment).toHaveBeenCalledWith(
        departmentRecord().id,
        expect.objectContaining({ campus_id: CAMPUS_ID, code: "SCI" }),
      );
    });
  });

  it("shows the server's campus error under the campus picker", async () => {
    const issue = 'Invalid pk "6a7b8c9d-0e1f-4a2b-8c3d-4e5f6a7b8c9d" - object does not exist.';
    so.updateDepartment.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: issue,
        status: 400,
        url: "/departments",
        details: [{ field: "campus_id", issue }],
      }),
    );
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit Accounts" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await within(dialog).findByText(issue)).toBeInTheDocument();
  });

  it("shows a conflict that names no field as the form's message", async () => {
    const message = "The request conflicts with existing data.";
    so.createDepartment.mockRejectedValue(
      new ApiError({ code: "conflict", message, status: 409, url: "/departments", details: [] }),
    );
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Add department" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Science");
    await user.type(within(dialog).getByLabelText("Code"), "SCI");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await within(dialog).findByText(
        "That change conflicts with the current data. Reload and try again.",
      ),
    ).toBeInTheDocument();
  });
});
