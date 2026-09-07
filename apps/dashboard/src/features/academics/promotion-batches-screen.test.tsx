import { ApiError } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PromotionBatchRecord } from "@/features/academics/academics-types";
import { PromotionBatchesScreen } from "@/features/academics/promotion-batches-screen";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { offsetPage, renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
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
 * against a table that never moved. `usePathname` is still here for `AcademicsNav`, and
 * `push` stays a plain spy: row navigation leaves this screen rather than changing its
 * query.
 */
const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();
const mockReplace = jest.fn((url: string) => {
  mockSearchParams = new URLSearchParams(url.split("?")[1] ?? "");
});
const mockRouter = { replace: mockReplace, push: mockPush, prefetch: jest.fn() };
jest.mock("next/navigation", () => ({
  usePathname: () => "/academics/promotions",
  useRouter: () => mockRouter,
  useSearchParams: () => mockSearchParams,
}));

/** The two reference lists, in mutable bindings so one test can hold them in the
 * `data: undefined` state the screen paints before they arrive. */
interface Option {
  id: string;
  name: string;
}
const SESSIONS: Option[] = [
  { id: "sess1", name: "2025-26" },
  { id: "sess2", name: "2026-27" },
];
const CLASSES: Option[] = [{ id: "class8", name: "Grade 8" }];
let mockSessions: { data: Option[] | undefined } = { data: SESSIONS };
let mockClasses: { data: Option[] | undefined } = { data: CLASSES };

jest.mock("@/features/students/use-reference-data", () => ({
  useAcademicSessions: () => mockSessions,
  useClasses: () => mockClasses,
}));
jest.mock("@/features/academics/promotion-batch-form", () => ({
  PromotionBatchForm: () => <div data-testid="promotion-batch-form" />,
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

/** A batch id is a v4 UUID; the column shows its first eight characters and keeps the
 * rest on the cell's `title`. A short stand-in would let the truncation break unnoticed. */
const BATCH_ID = "9f3c2a10-5b7e-4d21-8c66-1f0a9d4e77b2";
const BATCH_ID_SHOWN = "9f3c2a10";
const SECOND_BATCH_ID = "c4a71e88-2f60-4b9a-93d5-6e0b8c21af74";
const SECOND_BATCH_ID_SHOWN = "c4a71e88";

/**
 * Three days before the clock `renderWithProviders` installs (2026-01-01), so the
 * "Started" column reads "3 days ago" on any machine on any day.
 *
 * The screen passes next-intl's `now` into `formatRelativeTime` precisely so a test can
 * pin it — measuring against `new Date()` would make the cell read something different
 * every week the suite ran.
 */
const THREE_DAYS_AGO = "2025-12-29T00:00:00.000Z";

const ROW: PromotionBatchRecord = {
  batch_id: BATCH_ID,
  from_academic_session_id: "sess1",
  to_academic_session_id: "sess2",
  from_class_id: "class8",
  status: "pending_approval",
  students: 30,
  started_at: THREE_DAYS_AGO,
};

/** Two pages of batches, so the pager has somewhere to go. */
const FIRST_OF_TWO_PAGES = { total_count: 30, page_size: 25 };

function renderScreen() {
  return renderWithProviders(<PromotionBatchesScreen />);
}

describe("PromotionBatchesScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPush.mockReset();
    mockUsePermission.mockReturnValue(false);
    // The URL is state now, and it survives a render — reset it or the page a previous
    // test navigated to leaks into the next one.
    mockReplace.mockClear();
    mockSearchParams = new URLSearchParams();
    mockSessions = { data: SESSIONS };
    mockClasses = { data: CLASSES };
  });

  it("renders one row per batch, with its session pair, student count and status", async () => {
    mockGet.mockResolvedValue(offsetPage([ROW]));

    renderScreen();

    const cell = await screen.findByText(BATCH_ID_SHOWN);
    // The whole id stays one hover away, for pasting into a support thread.
    expect(cell).toHaveAttribute("title", BATCH_ID);

    const row = within(cell.closest("tr") as HTMLElement);
    expect(row.getByText("Grade 8")).toBeInTheDocument();
    expect(row.getByText("2025-26 → 2026-27")).toBeInTheDocument();
    expect(row.getByText("30")).toBeInTheDocument();
    expect(row.getByText("Pending approval")).toBeInTheDocument();
    // "3 days ago" is what a rollover batch is read by; the exact moment rides in the
    // tooltip on the same cell.
    expect(row.getByText("3 days ago")).toBeInTheDocument();
  });

  it("navigates to the batch review when a row is clicked", async () => {
    mockGet.mockResolvedValue(offsetPage([ROW]));

    renderScreen();

    const cell = await screen.findByText(BATCH_ID_SHOWN);
    fireEvent.click(cell.closest("tr") as HTMLElement);

    expect(mockPush).toHaveBeenCalledWith(`/academics/promotions/${BATCH_ID}`);
  });

  it("shows the translated empty state", async () => {
    mockGet.mockResolvedValue(offsetPage([]));

    renderScreen();

    expect(await screen.findByText("No promotion batches yet")).toBeInTheDocument();
    // No row range either: "1–0 of 0" under an empty state that has already said there
    // is nothing here is a second, worse way of saying the same thing.
    expect(screen.queryByText(/of 0/)).not.toBeInTheDocument();
  });

  it("renders the ApiError envelope in the table's error slot on failure", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "permission_denied",
        message: "nope",
        status: 403,
        url: "/student-promotions",
        requestId: "req-12",
      }),
    );

    renderScreen();

    expect(await screen.findByText(/You do not have permission to do that\./)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-12/)).toBeInTheDocument();
    // The table stays put — the envelope now goes into its own error slot — but the
    // empty state must NOT appear: a failed request is not an empty result set, and
    // saying so would tell the reader something untrue about their own school.
    expect(screen.queryByText("No promotion batches yet")).not.toBeInTheDocument();
  });

  it("hides the create-batch control without the create permission", async () => {
    mockGet.mockResolvedValue(offsetPage([ROW]));

    renderScreen();

    await screen.findByText(BATCH_ID_SHOWN);
    expect(screen.queryByTestId("promotion-batch-form")).not.toBeInTheDocument();
  });

  it("shows the create-batch control when permitted", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(offsetPage([ROW]));

    renderScreen();

    expect(await screen.findByTestId("promotion-batch-form")).toBeInTheDocument();
  });

  it("filters by class and by status", async () => {
    mockGet.mockResolvedValue(offsetPage([ROW]));
    const user = userEvent.setup();

    renderScreen();
    await screen.findByText(BATCH_ID_SHOWN);

    await user.click(screen.getByRole("combobox", { name: "Class" }));
    await user.click(await screen.findByRole("option", { name: "Grade 8" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ from_class_id: "class8" });
    });

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Approved" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ status: "approved" });
    });
  });

  it("filters by the source and target sessions", async () => {
    mockGet.mockResolvedValue(offsetPage([ROW]));
    const user = userEvent.setup();

    renderScreen();
    await screen.findByText(BATCH_ID_SHOWN);

    await user.click(screen.getByRole("combobox", { name: "From session" }));
    await user.click(await screen.findByRole("option", { name: "2025-26" }));
    await user.click(screen.getByRole("combobox", { name: "To session" }));
    await user.click(await screen.findByRole("option", { name: "2026-27" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({
        from_academic_session_id: "sess1",
        to_academic_session_id: "sess2",
      });
    });
  });

  it("asks the server for the page number the reader picks", async () => {
    mockGet.mockResolvedValue(offsetPage([ROW], FIRST_OF_TWO_PAGES));

    renderScreen();
    await screen.findByText(BATCH_ID_SHOWN);
    expect(screen.getByText("1–25 of 30")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBe(2);
    });
    // The range follows the reader's own page, not the `page: 1` the (kept-previous)
    // response still carries while the second page is in flight.
    expect(await screen.findByText("26–30 of 30")).toBeInTheDocument();
  });

  it("falls back to em dashes for the class and session names while the reference lists load", async () => {
    mockSessions = { data: undefined };
    mockClasses = { data: undefined };
    mockGet.mockResolvedValue(offsetPage([ROW]));
    const user = userEvent.setup();

    renderScreen();

    const cell = await screen.findByText(BATCH_ID_SHOWN);
    const row = cell.closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).getByText("— → —")).toBeInTheDocument();
    // The count, the status and the start date all live on the row itself, so none of
    // them waits on a lookup.
    expect(within(row).getByText("30")).toBeInTheDocument();
    expect(within(row).getByText("3 days ago")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "From session" }));

    // Scoped to the open listbox: the rows-per-page control at the foot of the card is
    // a native <select>, and its 25/50/100 children carry the `option` role too.
    const listbox = within(screen.getByRole("listbox"));
    expect(listbox.getAllByRole("option")).toHaveLength(1);
    expect(listbox.getByRole("option", { name: "All" })).toBeInTheDocument();
  });

  it("steps back to the first page, where Previous is no longer offered", async () => {
    mockGet.mockResolvedValueOnce(offsetPage([ROW], FIRST_OF_TWO_PAGES));
    mockGet.mockResolvedValueOnce(
      offsetPage([{ ...ROW, batch_id: SECOND_BATCH_ID }], { ...FIRST_OF_TWO_PAGES, page: 2 }),
    );
    mockGet.mockResolvedValue(offsetPage([ROW], FIRST_OF_TWO_PAGES));

    renderScreen();
    await screen.findByText(BATCH_ID_SHOWN);
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Go to page 2" }));
    // Await the second page's own row, not the request: the click below has to land on
    // a pager that has already moved.
    expect(await screen.findByText(SECOND_BATCH_ID_SHOWN)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous page" }));

    expect(await screen.findByText(BATCH_ID_SHOWN)).toBeInTheDocument();
    await waitFor(() => {
      // Page one is the absence of the parameter, not `page=1`.
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.page).toBeUndefined();
    });
    expect(screen.getByRole("button", { name: "Previous page" })).toBeDisabled();
  });
});
