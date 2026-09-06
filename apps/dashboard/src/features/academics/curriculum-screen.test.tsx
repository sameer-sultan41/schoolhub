import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { CurriculumScreen } from "@/features/academics/curriculum-screen";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
// CurriculumScreen never calls useSession itself — it renders <Can>, which reads
// usePermission/useAnyPermission — so those two are the ones to mock.
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/academics" }));

/** The four reference lists, in mutable bindings so one test can hold them in
 * the `data: undefined` state the grid paints before they arrive — every name in
 * a row is an id lookup into one of them. */
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
// The row-level editor and the clone wizard have their own specs; stubbing them
// keeps this one about the grid, its filters and its delete confirmation.
jest.mock("@/features/academics/curriculum-form", () => ({
  CurriculumForm: ({ mode }: { mode: string }) => <div data-testid={`curriculum-form-${mode}`} />,
}));
jest.mock("@/features/academics/clone-curriculum-dialog", () => ({
  CloneCurriculumDialog: () => <div data-testid="clone-dialog" />,
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const CORE_ROW = {
  id: "cs1",
  academic_session_id: "sess1",
  class_id: "class1",
  subject_id: "sub1",
  campus_id: "camp1",
  is_elective: false,
  elective_group: null,
  weekly_periods: 5,
  syllabus_file_id: null,
  term_plans: null,
  notes: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

const ELECTIVE_ROW = {
  ...CORE_ROW,
  id: "cs2",
  campus_id: null,
  is_elective: true,
  elective_group: "Languages",
  weekly_periods: 3,
};

function page(items: unknown[], nextCursor: string | null = null): ApiResult<unknown> {
  return {
    data: items,
    meta: { pagination: { next_cursor: nextCursor, previous_cursor: null, page_size: 25 } },
    requestId: "req-list",
    status: 200,
  };
}

describe("CurriculumScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockDelete.mockReset();
    mockUsePermission.mockReturnValue(false);
    mockSessions = { data: SESSIONS };
    mockClasses = { data: CLASSES };
    mockCampuses = { data: CAMPUSES };
    mockSubjects = { data: SUBJECTS };
  });

  it("shows skeleton rows while the first page loads", () => {
    mockGet.mockReturnValue(new Promise(() => undefined));

    renderWithProviders(<CurriculumScreen />);

    expect(screen.getByRole("table")).toHaveAttribute("aria-busy", "true");
  });

  it("renders a core row with its resolved session, class, subject and campus names", async () => {
    mockGet.mockResolvedValue(page([CORE_ROW]));

    renderWithProviders(<CurriculumScreen />);

    expect(await screen.findByText("Mathematics")).toBeInTheDocument();
    expect(screen.getByText("2026-27")).toBeInTheDocument();
    expect(screen.getByText("Grade 7")).toBeInTheDocument();
    expect(screen.getByText("Main Campus")).toBeInTheDocument();
    expect(screen.getByText("Core")).toBeInTheDocument();
    expect(screen.getByText("5")).toBeInTheDocument();
  });

  it("labels an elective with its group and shows a campus-wide row as all campuses", async () => {
    mockGet.mockResolvedValue(page([ELECTIVE_ROW]));

    renderWithProviders(<CurriculumScreen />);

    expect(await screen.findByText("Elective · Languages")).toBeInTheDocument();
    expect(screen.getByText("All campuses")).toBeInTheDocument();
  });

  it("shows the translated empty state when the session has no mappings", async () => {
    mockGet.mockResolvedValue(page([]));

    renderWithProviders(<CurriculumScreen />);

    expect(await screen.findByText("No subjects mapped yet")).toBeInTheDocument();
  });

  it("renders the ApiError envelope and the request id on a failed list", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/class-subjects",
        requestId: "req-9",
      }),
    );

    renderWithProviders(<CurriculumScreen />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-9/)).toBeInTheDocument();
    // The table stays put — the envelope now goes into its own error slot — but the
    // empty state must NOT appear: a failed request is not an empty result set, and
    // saying so would tell the reader something untrue about their own school.
    expect(screen.queryByText("No subjects mapped yet")).not.toBeInTheDocument();
  });

  it("hides every mutating control without the matching permission", async () => {
    mockGet.mockResolvedValue(page([CORE_ROW]));

    renderWithProviders(<CurriculumScreen />);

    await screen.findByText("Mathematics");
    expect(screen.queryByTestId("curriculum-form-create")).not.toBeInTheDocument();
    expect(screen.queryByTestId("curriculum-form-edit")).not.toBeInTheDocument();
    expect(screen.queryByTestId("clone-dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("shows the create, clone, edit and remove controls when permitted", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([CORE_ROW]));

    renderWithProviders(<CurriculumScreen />);

    // Await a *row* control, not a header one: the header renders before the
    // query settles, so awaiting `curriculum-form-create` resolves immediately
    // and the row assertions below race an empty table.
    expect(await screen.findByTestId("curriculum-form-edit")).toBeInTheDocument();
    expect(screen.getByTestId("curriculum-form-create")).toBeInTheDocument();
    expect(screen.getByTestId("clone-dialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });

  it("sends the chosen session as a filter and resets the cursor", async () => {
    mockGet.mockResolvedValue(page([CORE_ROW]));
    const user = userEvent.setup();

    renderWithProviders(<CurriculumScreen />);
    await screen.findByText("Mathematics");

    await user.click(screen.getByRole("combobox", { name: "Academic session" }));
    await user.click(await screen.findByRole("option", { name: "2026-27" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({
        academic_session_id: "sess1",
      });
    });
  });

  it("sends is_elective as a string filter when the type filter narrows", async () => {
    mockGet.mockResolvedValue(page([CORE_ROW]));
    const user = userEvent.setup();

    renderWithProviders(<CurriculumScreen />);
    await screen.findByText("Mathematics");

    await user.click(screen.getByRole("combobox", { name: "Type" }));
    await user.click(await screen.findByRole("option", { name: "Elective" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ is_elective: "true" });
    });
  });

  it("pages forward by cursor", async () => {
    mockGet.mockResolvedValue(page([CORE_ROW], "cursor-2"));

    renderWithProviders(<CurriculumScreen />);
    await screen.findByText("Mathematics");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.cursor).toBe("cursor-2");
    });
  });

  it("deletes a mapping from the confirmation dialog", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([CORE_ROW]));
    mockDelete.mockResolvedValue({ data: null, meta: undefined, requestId: null, status: 204 });
    const user = userEvent.setup();

    renderWithProviders(<CurriculumScreen />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "Mathematics will no longer be part of this class's curriculum for the session.",
      ),
    ).toBeInTheDocument();
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("/class-subjects/cs1");
    });
  });

  it("keeps the delete dialog open and renders the envelope when the server refuses", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([CORE_ROW]));
    mockDelete.mockRejectedValue(
      new ApiError({
        code: "domain_rule_violation",
        message: "Removing this leaves 'Languages' with no options.",
        status: 422,
        url: "/class-subjects/cs1",
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<CurriculumScreen />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(/isn't allowed right now/i)).toBeInTheDocument();
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("falls back to em dashes for every name while the reference lists are still loading", async () => {
    mockSessions = { data: undefined };
    mockClasses = { data: undefined };
    mockCampuses = { data: undefined };
    mockSubjects = { data: undefined };
    mockGet.mockResolvedValue(page([CORE_ROW]));
    const user = userEvent.setup();

    renderWithProviders(<CurriculumScreen />);

    const cell = await screen.findByText("5");
    const row = cell.closest("tr") as HTMLElement;
    // Session, class, subject and campus are all id lookups into lists that have
    // not arrived yet; the period count lives on the row itself.
    expect(within(row).getAllByText("—")).toHaveLength(4);
    expect(within(row).getByText("Core")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Academic session" }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "All" })).toBeInTheDocument();
  });

  it("names the subject with an em dash in the delete dialog when the subject list has not arrived", async () => {
    mockSubjects = { data: undefined };
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([CORE_ROW]));
    const user = userEvent.setup();

    renderWithProviders(<CurriculumScreen />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog");
    expect(
      within(dialog).getByText(
        "— will no longer be part of this class's curriculum for the session.",
      ),
    ).toBeInTheDocument();
  });

  it("labels an elective that belongs to no group as a plain elective", async () => {
    mockGet.mockResolvedValue(page([{ ...ELECTIVE_ROW, elective_group: null }]));

    renderWithProviders(<CurriculumScreen />);

    expect(await screen.findByText("Elective")).toBeInTheDocument();
    expect(screen.queryByText(/Elective ·/)).not.toBeInTheDocument();
  });

  it("filters by class and by campus", async () => {
    mockGet.mockResolvedValue(page([CORE_ROW]));
    const user = userEvent.setup();

    renderWithProviders(<CurriculumScreen />);
    await screen.findByText("Mathematics");

    await user.click(screen.getByRole("combobox", { name: "Class" }));
    await user.click(await screen.findByRole("option", { name: "Grade 7" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ class_id: "class1" });
    });

    await user.click(screen.getByRole("combobox", { name: "Campus" }));
    await user.click(await screen.findByRole("option", { name: "Main Campus" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ campus_id: "camp1" });
    });
  });

  it("steps back to the first page, where Previous is no longer offered", async () => {
    mockGet.mockResolvedValueOnce(page([CORE_ROW], "cursor-2"));
    mockGet.mockResolvedValueOnce(page([{ ...CORE_ROW, id: "cs9", weekly_periods: 9 }]));
    mockGet.mockResolvedValue(page([CORE_ROW], "cursor-2"));

    renderWithProviders(<CurriculumScreen />);
    await screen.findByText("5");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Await the second page's own row, not the request: Previous is guarded while
    // a page is still in flight, so the click below has to land after it settles.
    expect(await screen.findByText("9")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(await screen.findByText("5")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });
});
