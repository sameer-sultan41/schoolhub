import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationForm } from "@/features/academics/allocation-form";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { post: jest.fn() } }));
jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => ({ data: [{ id: "sess1", name: "2026-27" }] }),
  useClasses: () => ({ data: [{ id: "class1", name: "Grade 7" }] }),
}));
jest.mock("@/features/academics/use-academics-reference-data", () => ({
  useSections: () => ({ data: [{ id: "sec1", name: "A", class_id: "class1" }] }),
  useSubjects: () => ({ data: [{ id: "sub1", name: "Mathematics" }] }),
  useTeachingStaff: () => ({
    data: [{ id: "staff1", employee_number: "EMP-1", first_name: "Bilal", last_name: "Ahmed" }],
  }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;

function allocationResponse(warnings: unknown[]) {
  return {
    data: {
      id: "alloc1",
      academic_session_id: "sess1",
      section_id: "sec1",
      subject_id: "sub1",
      staff_id: "staff1",
      is_primary: true,
      weekly_periods: null,
      effective_from: null,
      effective_to: null,
      created_at: "2026-04-01T00:00:00Z",
      updated_at: "2026-04-01T00:00:00Z",
    },
    meta: { warnings },
    requestId: null,
    status: 201,
  };
}

async function openAndFill() {
  const user = userEvent.setup();
  renderWithProviders(<AllocationForm />);
  await user.click(screen.getByRole("button", { name: "Allocate a teacher" }));

  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("combobox", { name: "Academic session" }));
  await user.click(await screen.findByRole("option", { name: "2026-27" }));
  await user.click(within(dialog).getByRole("combobox", { name: "Section" }));
  await user.click(await screen.findByRole("option", { name: "Grade 7 A" }));
  await user.click(within(dialog).getByRole("combobox", { name: "Subject" }));
  await user.click(await screen.findByRole("option", { name: "Mathematics" }));
  await user.click(within(dialog).getByRole("combobox", { name: "Teacher" }));
  await user.click(await screen.findByRole("option", { name: "Bilal Ahmed" }));

  return { user, dialog };
}

describe("AllocationForm", () => {
  beforeEach(() => {
    mockPost.mockReset();
  });

  it("creates an allocation, sending a blank period override as null", async () => {
    mockPost.mockResolvedValue(allocationResponse([]));

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/teacher-subject-allocations", {
        academic_session_id: "sess1",
        section_id: "sec1",
        subject_id: "sub1",
        staff_id: "staff1",
        is_primary: true,
        weekly_periods: null,
        effective_from: null,
      });
    });
  });

  it("closes on a clean save", async () => {
    mockPost.mockResolvedValue(allocationResponse([]));

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("keeps the dialog open and shows the advisory over-norm warning", async () => {
    mockPost.mockResolvedValue(
      allocationResponse([
        { code: "teacher_over_norm", staff_id: "staff1", weekly_periods: 34, norm: 30 },
      ]),
    );

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "This teacher is now allocated 34 periods a week, above the norm of 30. The allocation was saved.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("sends a filled period override as a number", async () => {
    mockPost.mockResolvedValue(allocationResponse([]));

    const { user, dialog } = await openAndFill();
    await user.type(within(dialog).getByLabelText("Weekly periods"), "5");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost.mock.calls[0]?.[1]).toMatchObject({ weekly_periods: 5 });
    });
  });

  it("blocks a period override below 1 before it reaches the server", async () => {
    const { user, dialog } = await openAndFill();
    await user.type(within(dialog).getByLabelText("Weekly periods"), "0");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText(
        "Weekly periods must be a whole number of at least 1, or left blank.",
      ),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("puts a server field error on the field it names", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 422,
        url: "/teacher-subject-allocations",
        details: [{ field: "staff_id", issue: "This teacher is already allocated here." }],
      }),
    );

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("This teacher is already allocated here.")).toBeInTheDocument();
  });

  it("routes a rule with no matching control into the root message", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 422,
        url: "/teacher-subject-allocations",
        details: [{ field: "non_field", issue: "The subject is not in this class's curriculum." }],
      }),
    );

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("The subject is not in this class's curriculum."),
    ).toBeInTheDocument();
  });

  it("renders the error envelope for a non-validation failure", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "permission_denied",
        message: "nope",
        status: 403,
        url: "/teacher-subject-allocations",
        requestId: "req-5",
      }),
    );

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/You do not have permission to do that\./)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-5/)).toBeInTheDocument();
  });
});
