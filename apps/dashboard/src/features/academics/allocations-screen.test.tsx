import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AllocationsScreen } from "@/features/academics/allocations-screen";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { offsetPage, renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));

/**
 * The router has to ROUND-TRIP, not swallow the write.
 *
 * Filters, sort, hidden columns and page live in the URL now (`useTableParams` →
 * `useSearchParam`), so `replace` is what applies a page click and `useSearchParams` is
 * where the next render reads it back from. A `replace: jest.fn()` that stores nothing
 * would leave the screen on page one forever, and the pager assertions below would pass
 * against a table that never moved. `usePathname` is still here for `AcademicsNav`.
 */
let mockSearchParams = new URLSearchParams();
const mockReplace = jest.fn((url: string) => {
  mockSearchParams = new URLSearchParams(url.split("?")[1] ?? "");
});
const mockRouter = { replace: mockReplace, push: jest.fn(), prefetch: jest.fn() };
jest.mock("next/navigation", () => ({
  usePathname: () => "/academics/allocations",
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

/** The five reference lists, in mutable bindings so a test can hold any of them
 * in the `data: undefined` state the grid paints before they arrive — every name
 * in a row is an id lookup into one of them. */
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
// Both have their own specs; stubbing them keeps this one about the list.
jest.mock("@/features/academics/allocation-form", () => ({
  AllocationForm: () => <div data-testid="allocation-form" />,
}));
jest.mock("@/features/academics/teacher-load-summary", () => ({
  TeacherLoadSummary: ({ academicSessionId }: { academicSessionId: string }) => (
    <div data-testid="load-summary" data-session-id={academicSessionId} />
  ),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPatch = apiClient.patch as jest.MockedFunction<typeof apiClient.patch>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

/**
 * The date the "Effective" column renders, built the way `formatDate` builds it.
 *
 * Not a hand-typed "Jun 30, 2026": `new Date("2026-06-30")` is UTC midnight, which is
 * the day before in every zone behind UTC, and the medium-style pattern itself moves
 * with the ICU version. Same reasoning as `format.test.ts`'s currency case — assert the
 * cell went through a localized date format, not one machine's rendering of it.
 */
function mediumDate(isoDate: string): string {
  return new Intl.DateTimeFormat("en", { dateStyle: "medium" }).format(new Date(isoDate));
}

const CURRENT_PRIMARY = {
  id: "alloc1",
  academic_session_id: "sess1",
  section_id: "sec1",
  subject_id: "sub1",
  staff_id: "staff1",
  is_primary: true,
  weekly_periods: 6,
  effective_from: null,
  effective_to: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

const ENDED_CO_TEACHER = {
  ...CURRENT_PRIMARY,
  id: "alloc2",
  is_primary: false,
  weekly_periods: null,
  effective_from: "2026-04-01",
  effective_to: "2026-06-30",
};

/** Two pages of a 30-row allocation grid, so the pager has somewhere to go. */
const FIRST_OF_TWO_PAGES = { total_count: 30, page_size: 25 };

describe("AllocationsScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPatch.mockReset();
    mockDelete.mockReset();
    mockUsePermission.mockReturnValue(false);
    // The URL is state now, and it survives a render — reset it or the page a previous
    // test navigated to leaks into the next one.
    mockReplace.mockClear();
    mockSearchParams = new URLSearchParams();
    mockSessions = { data: SESSIONS };
    mockClasses = { data: CLASSES };
    mockSections = { data: SECTIONS };
    mockSubjects = { data: SUBJECTS };
    mockStaff = { data: STAFF };
  });

  it("renders a current primary allocation with its resolved names", async () => {
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY]));

    renderWithProviders(<AllocationsScreen />);

    const cell = await screen.findByText("Bilal Ahmed");
    const row = within(cell.closest("tr") as HTMLElement);
    expect(row.getByText("Grade 7 A")).toBeInTheDocument();
    expect(row.getByText("Mathematics")).toBeInTheDocument();
    expect(row.getByText("Primary")).toBeInTheDocument();
    expect(row.getByText("Current")).toBeInTheDocument();
    expect(row.getByText("6")).toBeInTheDocument();
    // The teacher is a person cell now — initials beside the name, both in one cell.
    expect(row.getByText("BA")).toBeInTheDocument();
  });

  it("renders an end-dated co-teacher row", async () => {
    mockGet.mockResolvedValue(offsetPage([ENDED_CO_TEACHER]));

    renderWithProviders(<AllocationsScreen />);

    expect(await screen.findByText("Co-teacher")).toBeInTheDocument();
    expect(screen.getByText(`Ended ${mediumDate("2026-06-30")}`)).toBeInTheDocument();
  });

  it("shows the translated empty state", async () => {
    mockGet.mockResolvedValue(offsetPage([]));

    renderWithProviders(<AllocationsScreen />);

    expect(await screen.findByText("No teachers allocated yet")).toBeInTheDocument();
    // No row range either: "1–0 of 0" under an empty state that has already said there
    // is nothing here is a second, worse way of saying the same thing.
    expect(screen.queryByText(/of 0/)).not.toBeInTheDocument();
  });

  it("renders the ApiError envelope in the table's error slot on failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/teacher-subject-allocations",
        requestId: "req-2",
      }),
    );

    renderWithProviders(<AllocationsScreen />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-2/)).toBeInTheDocument();
    // The table stays put — the envelope now goes into its own error slot — but the
    // empty state must NOT appear: a failed request is not an empty result set, and
    // saying so would tell the reader something untrue about their own school.
    expect(screen.queryByText("No teachers allocated yet")).not.toBeInTheDocument();
  });

  it("hides the create, end and remove controls without permission", async () => {
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY]));

    renderWithProviders(<AllocationsScreen />);

    await screen.findByText("Bilal Ahmed");
    expect(screen.queryByTestId("allocation-form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "End" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Remove" })).not.toBeInTheDocument();
  });

  it("prompts for a session before showing the load summary", async () => {
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY]));
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await screen.findByText("Bilal Ahmed");

    expect(
      screen.getByText("Choose a single academic session to see per-teacher load."),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("load-summary")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Academic session" }));
    await user.click(await screen.findByRole("option", { name: "2026-27" }));

    expect(await screen.findByTestId("load-summary")).toHaveAttribute("data-session-id", "sess1");
    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({
        academic_session_id: "sess1",
      });
    });
  });

  it("filters by teacher", async () => {
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY]));
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await screen.findByText("Bilal Ahmed");

    await user.click(screen.getByRole("combobox", { name: "Teacher" }));
    await user.click(await screen.findByRole("option", { name: "Bilal Ahmed" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ staff_id: "staff1" });
    });
  });

  it("asks the server for the page number the reader picks", async () => {
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY], FIRST_OF_TWO_PAGES));

    renderWithProviders(<AllocationsScreen />);
    await screen.findByText("Bilal Ahmed");
    expect(screen.getByText("1–25 of 30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBe(2);
    });
    // The range follows the reader's own page, not the `page: 1` the (kept-previous)
    // response still carries while the second page is in flight.
    expect(await screen.findByText("26–30 of 30")).toBeInTheDocument();
  });

  it("end-dates an allocation rather than deleting it", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY]));
    mockPatch.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 200 });
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await user.click(await screen.findByRole("button", { name: "End" }));

    const dialog = screen.getByRole("dialog");
    const confirm = within(dialog).getByRole("button", { name: "End" });
    expect(confirm).toBeDisabled();

    fireEvent.change(within(dialog).getByLabelText("Effective to"), {
      target: { value: "2026-06-30" },
    });
    await user.click(within(dialog).getByRole("button", { name: "End" }));

    await waitFor(() => {
      expect(mockPatch).toHaveBeenCalledWith("/teacher-subject-allocations/alloc1", {
        effective_to: "2026-06-30",
      });
    });
  });

  it("removes an allocation entered by mistake", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY]));
    mockDelete.mockResolvedValue({ data: null, meta: undefined, requestId: null, status: 204 });
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("/teacher-subject-allocations/alloc1");
    });
  });

  it("renders the envelope inside the remove dialog when the server refuses", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY]));
    mockDelete.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "in use",
        status: 409,
        url: "/teacher-subject-allocations/alloc1",
      }),
    );
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await user.click(await screen.findByRole("button", { name: "Remove" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove" }));

    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
  });

  it("falls back to em dashes for section, subject and teacher while the reference lists load", async () => {
    mockSessions = { data: undefined };
    mockClasses = { data: undefined };
    mockSections = { data: undefined };
    mockSubjects = { data: undefined };
    mockStaff = { data: undefined };
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY]));
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);

    const cell = await screen.findByText("6");
    const row = cell.closest("tr") as HTMLElement;
    // Section, subject and teacher are id lookups into lists that have not
    // arrived; the period count and the role live on the row itself, and an
    // allocation with no end date is "Current" rather than a dash.
    expect(within(row).getAllByText("—")).toHaveLength(3);
    expect(within(row).getByText("Primary")).toBeInTheDocument();
    // A teacher who cannot be named gets the dash alone, not an avatar with nobody
    // behind it.
    expect(within(row).queryByText("BA")).not.toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "Teacher" }));

    // Scoped to the open listbox: the rows-per-page control at the foot of the card is
    // a native <select>, and its 25/50/100 children carry the `option` role too.
    const listbox = within(screen.getByRole("listbox"));
    expect(listbox.getAllByRole("option")).toHaveLength(1);
    expect(listbox.getByRole("option", { name: "All" })).toBeInTheDocument();
  });

  it("labels a section by its own name while the class list is still loading", async () => {
    mockClasses = { data: undefined };
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY]));

    renderWithProviders(<AllocationsScreen />);

    const cell = await screen.findByText("Bilal Ahmed");
    const row = cell.closest("tr") as HTMLElement;
    // "Grade 7 A" minus the class it cannot name yet — never a stray leading space.
    expect(within(row).getByText("A")).toBeInTheDocument();
  });

  it("shows the start date of an allocation that began mid-session and has not ended", async () => {
    mockGet.mockResolvedValue(
      offsetPage([{ ...CURRENT_PRIMARY, effective_from: "2026-04-01", effective_to: null }]),
    );

    renderWithProviders(<AllocationsScreen />);

    expect(await screen.findByText(mediumDate("2026-04-01"))).toBeInTheDocument();
    expect(screen.queryByText("Current")).not.toBeInTheDocument();
  });

  it("filters by section and by subject", async () => {
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY]));
    const user = userEvent.setup();

    renderWithProviders(<AllocationsScreen />);
    await screen.findByText("Bilal Ahmed");

    await user.click(screen.getByRole("combobox", { name: "Section" }));
    await user.click(await screen.findByRole("option", { name: "Grade 7 A" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ section_id: "sec1" });
    });

    await user.click(screen.getByRole("combobox", { name: "Subject" }));
    await user.click(await screen.findByRole("option", { name: "Mathematics" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ subject_id: "sub1" });
    });
  });

  it("steps back to the first page, where Previous is no longer offered", async () => {
    mockGet.mockResolvedValue(offsetPage([CURRENT_PRIMARY], FIRST_OF_TWO_PAGES));

    renderWithProviders(<AllocationsScreen />);
    await screen.findByText("Bilal Ahmed");
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBe(2);
    });

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));

    await waitFor(() => {
      // Page one is the absence of the parameter, not `page=1`.
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBeUndefined();
    });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });
});
