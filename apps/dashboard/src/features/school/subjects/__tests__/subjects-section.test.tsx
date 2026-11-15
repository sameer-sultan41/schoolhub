import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import {
  DEPARTMENT_ID,
  structurePage,
  subjectRecord,
} from "@/services/modules/school-organization/__tests__/structure-fixtures";
import { SUBJECT_ID } from "@/test-fixtures/academics";
import { buildUser, renderWithProviders, setUrl } from "@/test-utils";

import { SubjectsSection } from "../subjects-section";

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
    dashboard: { fetchDepartments: jest.fn() },
    schoolOrganization: {
      fetchSubjectPage: jest.fn(),
      createSubject: jest.fn(),
      updateSubject: jest.fn(),
      deleteSubject: jest.fn(),
    },
  },
}));

const so = Services.schoolOrganization as jest.Mocked<typeof Services.schoolOrganization>;
const mockFetchCurrentUser = Services.auth.fetchCurrentUser as jest.MockedFunction<
  typeof Services.auth.fetchCurrentUser
>;
const mockFetchDepartments = Services.dashboard.fetchDepartments as jest.MockedFunction<
  typeof Services.dashboard.fetchDepartments
>;

const art = subjectRecord({
  id: "3b4c5d6e-7f8a-4b9c-8d0e-1f2a3b4c5d6e",
  name: "Art",
  code: "ART",
  subject_type: "co_curricular",
  department_id: null,
});

function renderSection() {
  renderWithProviders(<SubjectsSection />);
  return userEvent.setup();
}

describe("subjects section", () => {
  beforeEach(() => {
    setUrl("/school/subjects");
    mockFetchCurrentUser
      .mockReset()
      .mockResolvedValue(
        buildUser([
          "school.subject.view",
          "school.subject.create",
          "school.subject.update",
          "school.subject.delete",
        ]),
      );
    mockFetchDepartments.mockReset().mockResolvedValue([{ id: DEPARTMENT_ID, name: "Science" }]);
    so.fetchSubjectPage.mockReset().mockResolvedValue(structurePage([subjectRecord(), art]));
    so.createSubject.mockReset();
    so.updateSubject.mockReset();
    so.deleteSubject.mockReset();
  });

  it("names each subject's type and department, and none for one without", async () => {
    renderSection();

    const maths = await screen.findByRole("row", { name: /Mathematics/ });
    expect(within(maths).getByText("Core")).toBeInTheDocument();
    expect(await within(maths).findByText("Science")).toBeInTheDocument();
    const artRow = screen.getByRole("row", { name: /Art/ });
    expect(within(artRow).getByText("Co-curricular")).toBeInTheDocument();
    expect(within(artRow).getByText("No department")).toBeInTheDocument();
  });

  it("sends the department, type and status filters from the URL", async () => {
    setUrl(`/school/subjects?department=${DEPARTMENT_ID}&type=elective&status=active`);

    renderSection();

    await waitFor(() => {
      expect(so.fetchSubjectPage).toHaveBeenCalledWith(
        expect.objectContaining({
          departmentId: DEPARTMENT_ID,
          subjectType: "elective",
          isActive: true,
          ordering: "name",
        }),
      );
    });
  });

  it("filters by type through the API", async () => {
    const user = renderSection();

    await screen.findByRole("row", { name: /Mathematics/ });
    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Elective" }));

    await waitFor(() => {
      expect(so.fetchSubjectPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ subjectType: "elective", page: 1 }),
      );
    });

    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "All" }));

    await waitFor(() => {
      expect(so.fetchSubjectPage).toHaveBeenLastCalledWith(
        expect.objectContaining({ subjectType: undefined }),
      );
    });
  });

  it("adds an elective subject in a department", async () => {
    so.createSubject.mockResolvedValue(subjectRecord());
    const user = renderSection();

    await screen.findByRole("button", { name: "Edit Mathematics" });
    await user.click(screen.getByRole("button", { name: "Add subject" }));
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByLabelText("Name"), "Physics");
    await user.type(within(dialog).getByLabelText("Code"), "PHY");
    await user.click(within(dialog).getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Elective" }));
    await user.click(within(dialog).getByRole("combobox", { name: "Department" }));
    await user.click(await screen.findByRole("option", { name: "Science" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.createSubject).toHaveBeenCalledWith({
        name: "Physics",
        code: "PHY",
        subject_type: "elective",
        department_id: DEPARTMENT_ID,
        description: null,
        is_active: true,
      });
    });
  });

  it("moves a subject out of its department, sending a null department", async () => {
    so.updateSubject.mockResolvedValue(subjectRecord({ department_id: null }));
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit Mathematics" }));
    const dialog = await screen.findByRole("dialog");
    const department = within(dialog).getByRole("combobox", { name: "Department" });
    await waitFor(() => {
      expect(department).toHaveTextContent("Science");
    });
    await user.click(department);
    await user.click(await screen.findByRole("option", { name: "No department" }));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(so.updateSubject).toHaveBeenCalledWith(
        SUBJECT_ID,
        expect.objectContaining({ department_id: null, code: "MATH" }),
      );
    });
  });

  it("shows the server's code error under the code input", async () => {
    const issue = "Ensure this field has no more than 20 characters.";
    so.updateSubject.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: issue,
        status: 400,
        url: "/subjects",
        details: [{ field: "code", issue }],
      }),
    );
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Edit Art" }));
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    const message = await within(dialog).findByText(issue);
    expect(within(dialog).getByLabelText("Code").getAttribute("aria-describedby")).toContain(
      message.id,
    );
  });

  it("removes a subject", async () => {
    so.deleteSubject.mockResolvedValue(undefined);
    const user = renderSection();

    await user.click(await screen.findByRole("button", { name: "Remove Art" }));
    const dialog = await screen.findByRole("alertdialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(so.deleteSubject).toHaveBeenCalledWith(art.id);
    });
  });
});
