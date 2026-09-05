import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CurriculumRecord } from "@/features/academics/academics-types";
import { CurriculumForm } from "@/features/academics/curriculum-form";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { post: jest.fn(), patch: jest.fn() } }));
jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => ({ data: [{ id: "sess1", name: "2026-27" }] }),
  useClasses: () => ({ data: [{ id: "class1", name: "Grade 7" }] }),
  useCampuses: () => ({ data: [{ id: "camp1", name: "Main Campus" }] }),
}));
jest.mock("@/features/academics/use-academics-reference-data", () => ({
  useSubjects: () => ({ data: [{ id: "sub1", name: "Mathematics" }] }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;

const MAPPING: CurriculumRecord = {
  id: "cs1",
  academic_session_id: "sess1",
  class_id: "class1",
  subject_id: "sub1",
  campus_id: null,
  is_elective: false,
  elective_group: null,
  weekly_periods: 4,
  syllabus_file_id: null,
  term_plans: null,
  notes: "Split across two terms.",
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

async function openCreateAndPickKeys() {
  const user = userEvent.setup();
  renderWithProviders(<CurriculumForm mode="create" />);
  await user.click(screen.getByRole("button", { name: "Add subject" }));

  const dialog = screen.getByRole("dialog");
  await user.click(within(dialog).getByRole("combobox", { name: "Academic session" }));
  await user.click(await screen.findByRole("option", { name: "2026-27" }));
  await user.click(within(dialog).getByRole("combobox", { name: "Class" }));
  await user.click(await screen.findByRole("option", { name: "Grade 7" }));
  await user.click(within(dialog).getByRole("combobox", { name: "Subject" }));
  await user.click(await screen.findByRole("option", { name: "Mathematics" }));

  return { user, dialog };
}

describe("CurriculumForm", () => {
  beforeEach(() => {
    mockPost.mockReset();
    mockPatch.mockReset();
  });

  it("creates a core mapping, turning blank optional fields into nulls", async () => {
    mockPost.mockResolvedValue({
      data: MAPPING,
      meta: undefined,
      requestId: null,
      status: 201,
    });

    const { user, dialog } = await openCreateAndPickKeys();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/class-subjects", {
        academic_session_id: "sess1",
        class_id: "class1",
        subject_id: "sub1",
        campus_id: null,
        is_elective: false,
        elective_group: null,
        weekly_periods: 1,
        notes: null,
      });
    });
  });

  it("sends the weekly period target as a number, not the input's string", async () => {
    mockPost.mockResolvedValue({
      data: MAPPING,
      meta: undefined,
      requestId: null,
      status: 201,
    });

    const { user, dialog } = await openCreateAndPickKeys();
    const periods = within(dialog).getByLabelText("Weekly periods");
    await user.clear(periods);
    await user.type(periods, "6");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost.mock.calls[0]?.[1]).toMatchObject({ weekly_periods: 6 });
    });
  });

  it("blocks a weekly period target below 1 before it reaches the server", async () => {
    const { user, dialog } = await openCreateAndPickKeys();
    const periods = within(dialog).getByLabelText("Weekly periods");
    await user.clear(periods);
    await user.type(periods, "0");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Weekly periods must be a whole number of at least 1."),
    ).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("requires a group name once the mapping is marked elective", async () => {
    const { user, dialog } = await openCreateAndPickKeys();
    await user.click(within(dialog).getByLabelText("Elective subject"));
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("An elective needs a group name.")).toBeInTheDocument();
    expect(mockPost).not.toHaveBeenCalled();
  });

  it("patches the existing row in edit mode and locks its identifying fields", async () => {
    mockPatch.mockResolvedValue({
      data: MAPPING,
      meta: undefined,
      requestId: null,
      status: 200,
    });
    const user = userEvent.setup();

    renderWithProviders(<CurriculumForm mode="edit" mapping={MAPPING} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Academic session" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Class" })).toBeDisabled();
    expect(within(dialog).getByRole("combobox", { name: "Subject" })).toBeDisabled();
    expect(within(dialog).getByLabelText("Weekly periods")).toHaveValue(4);

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        "/class-subjects/cs1",
        expect.objectContaining({ weekly_periods: 4, notes: "Split across two terms." }),
      );
    });
  });

  it("puts a server field error on the field it names", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 422,
        url: "/class-subjects",
        details: [{ field: "weekly_periods", issue: "Must be at least 1." }],
      }),
    );

    const { user, dialog } = await openCreateAndPickKeys();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Must be at least 1.")).toBeInTheDocument();
  });

  it("routes a field with no control into the root message", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "validation_error",
        message: "Invalid.",
        status: 422,
        url: "/class-subjects",
        details: [{ field: "term_plans", issue: "These terms belong to another session." }],
      }),
    );

    const { user, dialog } = await openCreateAndPickKeys();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText("These terms belong to another session.")).toBeInTheDocument();
  });

  it("renders the envelope for a 422 that named no field, which would otherwise say nothing", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "weekly_periods must be at least 1.",
        status: 422,
        url: "/class-subjects",
        details: [{ issue: "weekly_periods must be at least 1." }],
      }),
    );

    const { user, dialog } = await openCreateAndPickKeys();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/isn't allowed right now/i)).toBeInTheDocument();
  });

  it("renders the error envelope for a non-validation failure", async () => {
    mockPost.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "already mapped",
        status: 409,
        url: "/class-subjects",
        requestId: "req-7",
      }),
    );

    const { user, dialog } = await openCreateAndPickKeys();
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-7/)).toBeInTheDocument();
  });
});
