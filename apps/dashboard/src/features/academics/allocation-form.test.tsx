import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationForm } from "@/features/academics/allocation-form";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { post: jest.fn() } }));

/** The five reference lists, in mutable bindings so a test can hold any of them
 * in the `data: undefined` state the dialog paints before they arrive. */
interface Option {
  id: string;
  name: string;
  class_id?: string;
}
interface StaffOption {
  id: string;
  employee_number: string;
  first_name: string;
  last_name: string;
}
const SESSIONS: Option[] = [{ id: "sess1", name: "2026-27" }];
const CLASSES: Option[] = [{ id: "class1", name: "Grade 7" }];
const SECTIONS: Option[] = [{ id: "sec1", name: "A", class_id: "class1" }];
const SUBJECTS: Option[] = [{ id: "sub1", name: "Mathematics" }];
const STAFF: StaffOption[] = [
  { id: "staff1", employee_number: "EMP-1", first_name: "Bilal", last_name: "Ahmed" },
];
let mockSessions: { data: Option[] | undefined } = { data: SESSIONS };
let mockClasses: { data: Option[] | undefined } = { data: CLASSES };
let mockSections: { data: Option[] | undefined } = { data: SECTIONS };
let mockSubjects: { data: Option[] | undefined } = { data: SUBJECTS };
let mockStaff: { data: StaffOption[] | undefined } = { data: STAFF };

jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => mockSessions,
  useClasses: () => mockClasses,
}));
jest.mock("@/features/academics/use-academics-reference-data", () => ({
  useSections: () => mockSections,
  useSubjects: () => mockSubjects,
  useTeachingStaff: () => mockStaff,
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
    mockSessions = { data: SESSIONS };
    mockClasses = { data: CLASSES };
    mockSections = { data: SECTIONS };
    mockSubjects = { data: SUBJECTS };
    mockStaff = { data: STAFF };
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

  it("drops the over-norm warning and the picked values once the dialog is dismissed", async () => {
    mockPost.mockResolvedValue(
      allocationResponse([
        { code: "teacher_over_norm", staff_id: "staff1", weekly_periods: 34, norm: 30 },
      ]),
    );

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));
    await screen.findByText(
      "This teacher is now allocated 34 periods a week, above the norm of 30. The allocation was saved.",
    );

    await user.click(within(dialog).getByRole("button", { name: "Close" }));
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Allocate a teacher" }));

    const reopened = screen.getByRole("dialog");
    expect(within(reopened).queryByText(/above the norm of 30/)).not.toBeInTheDocument();
    expect(within(reopened).getByRole("combobox", { name: "Academic session" })).toHaveTextContent(
      "Select a session",
    );
    expect(within(reopened).getByRole("combobox", { name: "Teacher" })).toHaveTextContent(
      "Select a teacher",
    );
  });

  it("saves a co-teacher when the primary box is unchecked", async () => {
    mockPost.mockResolvedValue(allocationResponse([]));

    const { user, dialog } = await openAndFill();
    const isPrimary = within(dialog).getByLabelText("Primary teacher");
    expect(isPrimary).toBeChecked();
    await user.click(isPrimary);
    expect(isPrimary).not.toBeChecked();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost.mock.calls[0]?.[1]).toMatchObject({ is_primary: false });
    });
  });

  it("sends the effective-from date the user picked", async () => {
    mockPost.mockResolvedValue(allocationResponse([]));

    const { user, dialog } = await openAndFill();
    fireEvent.change(within(dialog).getByLabelText("Effective from"), {
      target: { value: "2026-04-01" },
    });
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost.mock.calls[0]?.[1]).toMatchObject({ effective_from: "2026-04-01" });
    });
  });

  it("closes on a save whose envelope carries no meta at all", async () => {
    mockPost.mockResolvedValue({
      data: allocationResponse([]).data,
      meta: undefined,
      requestId: null,
      status: 201,
    });

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    // No `meta` means no warnings, which is a clean save, not an unreadable one.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  it("labels a section by its own name while the class list is still loading", async () => {
    mockClasses = { data: undefined };
    const user = userEvent.setup();

    renderWithProviders(<AllocationForm />);
    await user.click(screen.getByRole("button", { name: "Allocate a teacher" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Section" }));

    // "Grade 7 A" minus the class it cannot name yet — never a stray leading space.
    expect(await screen.findByRole("option", { name: "A" })).toBeInTheDocument();
  });

  it("offers no options in any select while the reference lists are still loading", async () => {
    mockSessions = { data: undefined };
    mockSections = { data: undefined };
    mockSubjects = { data: undefined };
    mockStaff = { data: undefined };
    const user = userEvent.setup();

    renderWithProviders(<AllocationForm />);
    await user.click(screen.getByRole("button", { name: "Allocate a teacher" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Section" })).toHaveTextContent(
      "Select a section",
    );
    expect(within(dialog).getByRole("combobox", { name: "Teacher" })).toHaveTextContent(
      "Select a teacher",
    );

    await user.click(within(dialog).getByRole("combobox", { name: "Academic session" }));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("shows no message at all when the client rejects with something that is not an ApiError", async () => {
    mockPost.mockRejectedValue(new TypeError("Failed to fetch"));

    const { user, dialog } = await openAndFill();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalled();
    });
    // The API envelope is the only thing this form renders, so a non-ApiError
    // rejection leaves the dialog open and unannotated.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
