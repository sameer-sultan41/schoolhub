import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubstitutionsScreen } from "@/features/timetable/substitutions-screen";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { formatDate } from "@/lib/format";
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
 * Filters, sort and page live in the URL now (`useTableParams` → `useSearchParam`), so
 * `replace` is what applies a page click and `useSearchParams` is where the next render
 * reads it back from. A `replace: jest.fn()` that stores nothing would leave the screen
 * on page one forever, and the pager assertions below would pass against a table that
 * never moved. `usePathname` is still here for `TimetableNav`.
 */
let mockSearchParams = new URLSearchParams();
const mockReplace = jest.fn((url: string) => {
  mockSearchParams = new URLSearchParams(url.split("?")[1] ?? "");
});
const mockRouter = { replace: mockReplace, push: jest.fn(), prefetch: jest.fn() };
jest.mock("next/navigation", () => ({
  usePathname: () => "/timetable/substitutions",
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

jest.mock("@/features/timetable/use-timetable-reference-data", () => ({
  useTeachingStaffOptions: () => ({
    data: [
      { id: "staff1", employee_number: "EMP-1", first_name: "Bilal", last_name: "Ahmed" },
      { id: "staff2", employee_number: "EMP-2", first_name: "Sana", last_name: "Iqbal" },
    ],
  }),
}));
jest.mock("@/features/timetable/substitution-form", () => ({
  SubstitutionForm: () => <div data-testid="substitution-form" />,
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

const PROPOSED = {
  id: "sub1",
  timetable_slot_id: "slot1",
  date: "2026-09-08",
  absent_staff_id: "staff1",
  substitute_staff_id: "staff2",
  reason: "Medical leave",
  leave_request_id: null,
  status: "proposed" as const,
  created_at: "2026-09-01T00:00:00Z",
  updated_at: "2026-09-01T00:00:00Z",
};

const CONFIRMED = { ...PROPOSED, id: "sub2", status: "confirmed" as const, reason: null };

describe("SubstitutionsScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockUsePermission.mockReturnValue(false);
    mockSearchParams = new URLSearchParams();
  });

  it("resolves both teachers by name and shows the status", async () => {
    mockGet.mockResolvedValue(offsetPage([PROPOSED]));
    renderWithProviders(<SubstitutionsScreen />);

    const row = await screen.findByRole("row", { name: /Bilal Ahmed/ });
    expect(within(row).getByText("Bilal Ahmed")).toBeInTheDocument();
    expect(within(row).getByText("Sana Iqbal")).toBeInTheDocument();
    expect(within(row).getByText("Medical leave")).toBeInTheDocument();
    expect(within(row).getByText("Proposed")).toBeInTheDocument();
    // Localized, not the wire value. Composed through `formatDate` rather than spelled
    // out because "Sep 8, 2026" is only what a UTC+n runner would render — a machine
    // behind UTC formats the same instant as the day before.
    expect(within(row).getByText(formatDate(PROPOSED.date, "en"))).toBeInTheDocument();
    expect(screen.queryByText("2026-09-08")).not.toBeInTheDocument();
  });

  it("shows the translated empty state", async () => {
    mockGet.mockResolvedValue(offsetPage([]));
    renderWithProviders(<SubstitutionsScreen />);

    expect(await screen.findByText("No substitutions yet")).toBeInTheDocument();
    // The row range is suppressed on an empty result: "0–0 of 0" beneath an empty state
    // that has already said there is nothing here is noise.
    expect(screen.queryByText("0–0 of 0")).not.toBeInTheDocument();
  });

  it("filters by status", async () => {
    mockGet.mockResolvedValue(offsetPage([PROPOSED]));
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionsScreen />);
    await screen.findByText("Bilal Ahmed");

    // The filter row sits inside the table's card now, but the select is still named by
    // its label, so the reader reaches it exactly as before.
    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Confirmed" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ status: "confirmed" });
    });
  });

  // The names have to be django-filter's own, derived from
  // `TeacherSubstitutionFilterSet`'s `"date": ["exact", "gte", "lte"]`. Anything
  // else is dropped in silence — the request succeeds and answers with the
  // unfiltered list, so a `toMatchObject` on the wrong keys was the only thing
  // holding the range up.
  it("filters by a date range on the parameter names the backend derives", async () => {
    mockGet.mockResolvedValue(offsetPage([PROPOSED]));
    renderWithProviders(<SubstitutionsScreen />);
    await screen.findByText("Bilal Ahmed");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-30" } });

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({
        date__gte: "2026-09-01",
        date__lte: "2026-09-30",
      });
    });
    expect(mockGet.mock.calls.at(-1)?.[1]?.query).not.toHaveProperty("date_from");
    expect(mockGet.mock.calls.at(-1)?.[1]?.query).not.toHaveProperty("date_to");
  });

  it("clicking a page number asks the server for that page", async () => {
    // Two pages' worth: the pager only renders numbers when there is somewhere to go.
    mockGet.mockResolvedValue(offsetPage([PROPOSED], { total_count: 30, page_size: 25 }));
    renderWithProviders(<SubstitutionsScreen />);
    await screen.findByText("Bilal Ahmed");

    // With a page number on screen, where the reader is in the list is finally a fact
    // the summary can state — it said nothing at all under cursor paging.
    expect(screen.getByText("1–25 of 30")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBe(2);
    });
  });

  it("hides the proposal form and the decision buttons without permission", async () => {
    mockGet.mockResolvedValue(offsetPage([PROPOSED]));
    renderWithProviders(<SubstitutionsScreen />);

    await screen.findByText("Bilal Ahmed");
    expect(screen.queryByTestId("substitution-form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("offers a decision only on a proposal", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([CONFIRMED]));
    renderWithProviders(<SubstitutionsScreen />);

    await screen.findByText("Confirmed");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("approves a proposal", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([PROPOSED]));
    mockPost.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 200 });
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionsScreen />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/teacher-substitutions/sub1:approve", {});
    });
  });

  it("rejects a proposal", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([PROPOSED]));
    mockPost.mockResolvedValue({ data: {}, meta: undefined, requestId: null, status: 200 });
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionsScreen />);

    await user.click(await screen.findByRole("button", { name: "Reject" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/teacher-substitutions/sub1:reject", {});
    });
  });

  it("renders the envelope when a decision is refused as already made", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([PROPOSED]));
    mockPost.mockRejectedValue(
      new ApiError({
        code: "conflict",
        message: "This substitution is confirmed and cannot be decided again.",
        status: 409,
        url: "/teacher-substitutions/sub1:approve",
      }),
    );
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionsScreen />);

    await user.click(await screen.findByRole("button", { name: "Approve" }));

    expect(await screen.findByText(/conflicts with the current data/i)).toBeInTheDocument();
  });

  it("renders the error envelope in the table's error slot on failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/teacher-substitutions",
        requestId: "req-2",
      }),
    );
    renderWithProviders(<SubstitutionsScreen />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
    // The table stays put — the envelope now goes into its own error slot — but the
    // empty state must NOT appear: a failed request is not an empty result set, and
    // saying so would tell the reader something untrue about their own school.
    expect(screen.queryByText("No substitutions yet")).not.toBeInTheDocument();
  });
});
