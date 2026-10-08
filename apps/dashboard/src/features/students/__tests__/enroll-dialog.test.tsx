import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";
import { EnrollDialog } from "../enroll-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    schoolOrganization: {
      fetchAcademicSessions: jest.fn(),
      fetchClasses: jest.fn(),
      fetchSections: jest.fn(),
    },
    students: { enrollStudent: jest.fn() },
  },
}));

const mockFetchAcademicSessions = Services.schoolOrganization
  .fetchAcademicSessions as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchAcademicSessions
>;
const mockFetchClasses = Services.schoolOrganization.fetchClasses as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchClasses
>;
const mockFetchSections = Services.schoolOrganization.fetchSections as jest.MockedFunction<
  typeof Services.schoolOrganization.fetchSections
>;
const mockEnrollStudent = Services.students.enrollStudent as jest.MockedFunction<
  typeof Services.students.enrollStudent
>;

function baseProps() {
  return {
    studentId: "student-1",
    campusId: "campus-1",
    canOverrideCapacity: true,
    open: true,
    onOpenChange: jest.fn(),
  };
}

describe("EnrollDialog", () => {
  beforeEach(() => {
    mockFetchAcademicSessions.mockReset();
    mockFetchClasses.mockReset();
    mockFetchSections.mockReset();
    mockEnrollStudent.mockReset();
    mockFetchAcademicSessions.mockResolvedValue([
      { id: "sess-1", name: "2026-27", status: "active", is_current: true },
      { id: "sess-closed", name: "2024-25", status: "closed", is_current: false },
    ]);
    mockFetchClasses.mockResolvedValue([{ id: "class-1", name: "Grade 1" }]);
    mockFetchSections.mockResolvedValue([{ id: "section-1", name: "A" }]);
  });

  it("excludes closed/archived sessions from the session picker", async () => {
    renderWithProviders(<EnrollDialog {...baseProps()} />);

    await userEvent.click(screen.getByRole("combobox", { name: /academic session/i }));

    expect(await screen.findByRole("option", { name: "2026-27" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "2024-25" })).not.toBeInTheDocument();
  });

  it("shows the capacity-override-reason field when canOverrideCapacity", () => {
    renderWithProviders(<EnrollDialog {...baseProps()} canOverrideCapacity />);

    expect(screen.getByLabelText(/capacity override reason/i)).toBeInTheDocument();
  });

  it("hides the override-reason field when the caller cannot override capacity", () => {
    renderWithProviders(<EnrollDialog {...baseProps()} canOverrideCapacity={false} />);

    expect(screen.queryByLabelText(/capacity override reason/i)).not.toBeInTheDocument();
  });

  it("submits enrollStudent with a fresh idempotency key and invalidates the students module on success", async () => {
    mockEnrollStudent.mockResolvedValue({ id: "e1" } as never);
    renderWithProviders(<EnrollDialog {...baseProps()} />);

    await userEvent.click(screen.getByRole("combobox", { name: /academic session/i }));
    await userEvent.click(await screen.findByRole("option", { name: "2026-27" }));
    await userEvent.click(screen.getByRole("combobox", { name: /class/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Grade 1" }));
    await userEvent.click(screen.getByRole("combobox", { name: /section/i }));
    await userEvent.click(await screen.findByRole("option", { name: "A" }));
    await userEvent.type(screen.getByLabelText(/enrollment date/i), "2026-04-05");
    await userEvent.click(screen.getByRole("button", { name: /^enroll$/i }));

    await waitFor(() => {
      expect(mockEnrollStudent).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({
          academicSessionId: "sess-1",
          classId: "class-1",
          sectionId: "section-1",
          enrollmentDate: "2026-04-05",
        }),
        expect.any(String),
      );
    });
  });

  it("maps a 422 capacity error onto the non_field form message", async () => {
    mockEnrollStudent.mockRejectedValue(
      new ApiError({
        status: 422,
        code: "domain_rule_violation",
        message: "Capacity exceeded.",
        url: "/students/student-1:enroll",
        details: [{ field: "non_field", issue: "Capacity exceeded." }],
        requestId: "req-1",
      }),
    );
    renderWithProviders(<EnrollDialog {...baseProps()} />);

    await userEvent.click(screen.getByRole("combobox", { name: /academic session/i }));
    await userEvent.click(await screen.findByRole("option", { name: "2026-27" }));
    await userEvent.click(screen.getByRole("combobox", { name: /class/i }));
    await userEvent.click(await screen.findByRole("option", { name: "Grade 1" }));
    await userEvent.click(screen.getByRole("combobox", { name: /section/i }));
    await userEvent.click(await screen.findByRole("option", { name: "A" }));
    await userEvent.type(screen.getByLabelText(/enrollment date/i), "2026-04-05");
    await userEvent.click(screen.getByRole("button", { name: /^enroll$/i }));

    expect(await screen.findByText("Capacity exceeded.")).toBeInTheDocument();
  });

  it("closes without submitting when Cancel is clicked", async () => {
    const onOpenChange = jest.fn();
    renderWithProviders(<EnrollDialog {...baseProps()} onOpenChange={onOpenChange} />);

    await userEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(mockEnrollStudent).not.toHaveBeenCalled();
  });
});
