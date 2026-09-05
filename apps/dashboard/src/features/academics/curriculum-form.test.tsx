import { ApiError } from "@schoolhub/api-client";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { CurriculumRecord } from "@/features/academics/academics-types";
import { CurriculumForm } from "@/features/academics/curriculum-form";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { post: jest.fn(), patch: jest.fn() } }));

/** The four reference lists, in mutable bindings so one test can hold them in
 * the `data: undefined` state the dialog paints before they arrive. */
interface Option {
  id: string;
  name: string;
}
const SESSIONS: Option[] = [{ id: "sess1", name: "2026-27" }];
const CLASSES: Option[] = [{ id: "class1", name: "Grade 7" }];
const CAMPUSES: Option[] = [{ id: "camp1", name: "Main Campus" }];
const SUBJECTS: Option[] = [{ id: "sub1", name: "Mathematics" }];
let mockSessions: { data: Option[] | undefined } = { data: SESSIONS };
let mockClasses: { data: Option[] | undefined } = { data: CLASSES };
let mockCampuses: { data: Option[] | undefined } = { data: CAMPUSES };
let mockSubjects: { data: Option[] | undefined } = { data: SUBJECTS };

jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => mockSessions,
  useClasses: () => mockClasses,
  useCampuses: () => mockCampuses,
}));
jest.mock("@/features/academics/use-academics-reference-data", () => ({
  useSubjects: () => mockSubjects,
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

/** The other shape of a row: pinned to one campus, and part of an elective group. */
const ELECTIVE_MAPPING: CurriculumRecord = {
  ...MAPPING,
  id: "cs2",
  campus_id: "camp1",
  is_elective: true,
  elective_group: "Languages",
  notes: null,
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
    mockSessions = { data: SESSIONS };
    mockClasses = { data: CLASSES };
    mockCampuses = { data: CAMPUSES };
    mockSubjects = { data: SUBJECTS };
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
    const periods = within(dialog).getByLabelText(/Weekly periods/);
    await user.clear(periods);
    await user.type(periods, "6");
    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPost.mock.calls[0]?.[1]).toMatchObject({ weekly_periods: 6 });
    });
  });

  it("blocks a weekly period target below 1 before it reaches the server", async () => {
    const { user, dialog } = await openCreateAndPickKeys();
    const periods = within(dialog).getByLabelText(/Weekly periods/);
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
    await user.click(within(dialog).getByLabelText(/Elective subject/));
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
    expect(within(dialog).getByLabelText(/Weekly periods/)).toHaveValue(4);

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

  it("prefills and resends the campus and elective group of a campus-scoped elective", async () => {
    mockPatch.mockResolvedValue({
      data: ELECTIVE_MAPPING,
      meta: undefined,
      requestId: null,
      status: 200,
    });
    const user = userEvent.setup();

    renderWithProviders(<CurriculumForm mode="edit" mapping={ELECTIVE_MAPPING} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Campus" })).toHaveTextContent(
      "Main Campus",
    );
    expect(within(dialog).getByLabelText(/Elective subject/)).toBeChecked();
    expect(within(dialog).getByLabelText("Elective group")).toHaveValue("Languages");

    await user.click(within(dialog).getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith(
        "/class-subjects/cs2",
        expect.objectContaining({
          campus_id: "camp1",
          is_elective: true,
          elective_group: "Languages",
        }),
      );
    });
  });

  it("restores the row's own values when a dismissed edit dialog is reopened", async () => {
    const user = userEvent.setup();

    renderWithProviders(<CurriculumForm mode="edit" mapping={MAPPING} />);
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const dialog = screen.getByRole("dialog");
    const periods = within(dialog).getByLabelText(/Weekly periods/);
    await user.clear(periods);
    await user.type(periods, "9");
    await user.click(within(dialog).getByRole("button", { name: "Close" }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Edit" }));

    const reopened = screen.getByRole("dialog");
    expect(within(reopened).getByLabelText(/Weekly periods/)).toHaveValue(4);
    expect(within(reopened).getByLabelText("Notes")).toHaveValue("Split across two terms.");
    expect(mockPatch).not.toHaveBeenCalled();
  });

  it("offers no options in any select while the reference lists are still loading", async () => {
    mockSessions = { data: undefined };
    mockClasses = { data: undefined };
    mockCampuses = { data: undefined };
    mockSubjects = { data: undefined };
    const user = userEvent.setup();

    renderWithProviders(<CurriculumForm mode="create" />);
    await user.click(screen.getByRole("button", { name: "Add subject" }));

    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByRole("combobox", { name: "Class" })).toHaveTextContent(
      "Select a class",
    );
    expect(within(dialog).getByRole("combobox", { name: "Subject" })).toHaveTextContent(
      "Select a subject",
    );
    expect(within(dialog).getByRole("combobox", { name: "Campus" })).toHaveTextContent(
      "All campuses",
    );

    await user.click(within(dialog).getByRole("combobox", { name: "Academic session" }));
    expect(screen.queryAllByRole("option")).toHaveLength(0);
  });

  it("shows no message at all when the client rejects with something that is not an ApiError", async () => {
    mockPost.mockRejectedValue(new TypeError("Failed to fetch"));

    const { user, dialog } = await openCreateAndPickKeys();
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
