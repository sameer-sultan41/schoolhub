import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { ChangeSectionDialog } from "../change-section-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    schoolOrganization: { fetchClasses: jest.fn(), fetchSections: jest.fn() },
    students: { changeStudentSection: jest.fn() },
  },
}));

const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;
const mockChangeStudentSection = Services.students.changeStudentSection as jest.MockedFunction<
  typeof Services.students.changeStudentSection
>;

function baseProps() {
  return {
    studentId: "student-1",
    campusId: "campus-2",
    currentClass: { id: "class-1", name: "Grade 1" },
    canOverrideCapacity: true,
    open: true,
    onOpenChange: jest.fn(),
  };
}

describe("ChangeSectionDialog", () => {
  beforeEach(() => {
    mockFetchSections.mockReset();
    mockChangeStudentSection.mockReset();
    mockFetchSections.mockResolvedValue([{ id: "section-2", name: "B" }]);
  });

  it("shows the current class as a fixed label, not an editable field", () => {
    renderWithProviders(<ChangeSectionDialog {...baseProps()} />);

    expect(screen.queryByRole("combobox", { name: /^class$/i })).not.toBeInTheDocument();
    expect(screen.getByText("Grade 1")).toBeInTheDocument();
  });

  it("scopes the section picker to the destination campus and the current class", async () => {
    renderWithProviders(<ChangeSectionDialog {...baseProps()} />);

    await userEvent.click(screen.getByRole("combobox", { name: /section/i }));
    await screen.findByRole("option", { name: "B" });

    expect(mockFetchSections).toHaveBeenCalledWith({
      classId: "class-1",
      campusId: "campus-2",
      isActive: true,
    });
  });

  it("shows the capacity-override-reason field when canOverrideCapacity", () => {
    renderWithProviders(<ChangeSectionDialog {...baseProps()} canOverrideCapacity />);

    expect(screen.getByLabelText(/capacity override reason/i)).toBeInTheDocument();
  });

  it("hides the override-reason field when the caller cannot override capacity", () => {
    renderWithProviders(<ChangeSectionDialog {...baseProps()} canOverrideCapacity={false} />);

    expect(screen.queryByLabelText(/capacity override reason/i)).not.toBeInTheDocument();
  });

  it("submits changeStudentSection with section_id only — never class_id", async () => {
    mockChangeStudentSection.mockResolvedValue({ id: "e1" } as never);
    renderWithProviders(<ChangeSectionDialog {...baseProps()} />);

    await userEvent.click(screen.getByRole("combobox", { name: /section/i }));
    await userEvent.click(await screen.findByRole("option", { name: "B" }));
    await userEvent.click(screen.getByRole("button", { name: /change section/i }));

    await waitFor(() => {
      expect(mockChangeStudentSection).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({ sectionId: "section-2" }),
        expect.any(String),
      );
    });
    const [, input] = mockChangeStudentSection.mock.calls[0] as [string, Record<string, unknown>];
    expect(input).not.toHaveProperty("classId");
  });

  it("maps a 422 capacity error onto the non_field form message", async () => {
    mockChangeStudentSection.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "domain_rule_violation",
        message: "Capacity exceeded.",
        url: "/students/student-1:change-section",
        details: [{ field: "non_field", issue: "Capacity exceeded." }],
        requestId: "req-1",
      }),
    );
    renderWithProviders(<ChangeSectionDialog {...baseProps()} />);

    await userEvent.click(screen.getByRole("combobox", { name: /section/i }));
    await userEvent.click(await screen.findByRole("option", { name: "B" }));
    await userEvent.click(screen.getByRole("button", { name: /change section/i }));

    expect(await screen.findByText("Capacity exceeded.")).toBeInTheDocument();
  });
});
