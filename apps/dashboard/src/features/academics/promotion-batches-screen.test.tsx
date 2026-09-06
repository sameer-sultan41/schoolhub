import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { PromotionBatchRecord } from "@/features/academics/academics-types";
import { PromotionBatchesScreen } from "@/features/academics/promotion-batches-screen";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
const mockPush = jest.fn();
jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, replace: jest.fn() }),
  usePathname: () => "/academics/promotions",
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

const ROW: PromotionBatchRecord = {
  batch_id: "batch-1",
  from_academic_session_id: "sess1",
  to_academic_session_id: "sess2",
  from_class_id: "class8",
  status: "pending_approval",
  students: 30,
  started_at: "2026-04-01T00:00:00Z",
};

function page(items: unknown[], nextCursor: string | null = null): ApiResult<unknown> {
  return {
    data: items,
    meta: { pagination: { next_cursor: nextCursor, previous_cursor: null, page_size: 25 } },
    requestId: "req-list",
    status: 200,
  };
}

describe("PromotionBatchesScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPush.mockReset();
    mockUsePermission.mockReturnValue(false);
    mockSessions = { data: SESSIONS };
    mockClasses = { data: CLASSES };
  });

  it("renders one row per batch, with its session pair, student count and status", async () => {
    mockGet.mockResolvedValue(page([ROW]));

    renderWithProviders(<PromotionBatchesScreen />);

    expect(await screen.findByText("batch-1")).toBeInTheDocument();
    expect(screen.getByText("Grade 8")).toBeInTheDocument();
    expect(screen.getByText("2025-26 → 2026-27")).toBeInTheDocument();
    expect(screen.getByText("30")).toBeInTheDocument();
    expect(screen.getByText("Pending approval")).toBeInTheDocument();
  });

  it("navigates to the batch review when a row is clicked", async () => {
    mockGet.mockResolvedValue(page([ROW]));

    renderWithProviders(<PromotionBatchesScreen />);

    const cell = await screen.findByText("batch-1");
    fireEvent.click(cell.closest("tr") as HTMLElement);

    expect(mockPush).toHaveBeenCalledWith("/academics/promotions/batch-1");
  });

  it("shows the translated empty state", async () => {
    mockGet.mockResolvedValue(page([]));

    renderWithProviders(<PromotionBatchesScreen />);

    expect(await screen.findByText("No promotion batches yet")).toBeInTheDocument();
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

    renderWithProviders(<PromotionBatchesScreen />);

    expect(await screen.findByText(/You do not have permission to do that\./)).toBeInTheDocument();
    expect(screen.getByText(/Reference: req-12/)).toBeInTheDocument();
    // The table stays put — the envelope now goes into its own error slot — but the
    // empty state must NOT appear: a failed request is not an empty result set, and
    // saying so would tell the reader something untrue about their own school.
    expect(screen.queryByText("No promotion batches yet")).not.toBeInTheDocument();
  });

  it("hides the create-batch control without the create permission", async () => {
    mockGet.mockResolvedValue(page([ROW]));

    renderWithProviders(<PromotionBatchesScreen />);

    await screen.findByText("batch-1");
    expect(screen.queryByTestId("promotion-batch-form")).not.toBeInTheDocument();
  });

  it("shows the create-batch control when permitted", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([ROW]));

    renderWithProviders(<PromotionBatchesScreen />);

    expect(await screen.findByTestId("promotion-batch-form")).toBeInTheDocument();
  });

  it("filters by class and by status", async () => {
    mockGet.mockResolvedValue(page([ROW]));
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchesScreen />);
    await screen.findByText("batch-1");

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
    mockGet.mockResolvedValue(page([ROW]));
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchesScreen />);
    await screen.findByText("batch-1");

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

  it("pages forward by cursor", async () => {
    mockGet.mockResolvedValue(page([ROW], "cursor-2"));

    renderWithProviders(<PromotionBatchesScreen />);
    await screen.findByText("batch-1");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.cursor).toBe("cursor-2");
    });
  });

  it("falls back to em dashes for the class and session names while the reference lists load", async () => {
    mockSessions = { data: undefined };
    mockClasses = { data: undefined };
    mockGet.mockResolvedValue(page([ROW]));
    const user = userEvent.setup();

    renderWithProviders(<PromotionBatchesScreen />);

    const cell = await screen.findByText("batch-1");
    const row = cell.closest("tr") as HTMLElement;
    expect(within(row).getByText("—")).toBeInTheDocument();
    expect(within(row).getByText("— → —")).toBeInTheDocument();
    expect(within(row).getByText("30")).toBeInTheDocument();

    await user.click(screen.getByRole("combobox", { name: "From session" }));
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option", { name: "All" })).toBeInTheDocument();
  });

  it("steps back to the first page, where Previous is no longer offered", async () => {
    mockGet.mockResolvedValueOnce(page([ROW], "cursor-2"));
    mockGet.mockResolvedValueOnce(page([{ ...ROW, batch_id: "batch-2" }]));
    mockGet.mockResolvedValue(page([ROW], "cursor-2"));

    renderWithProviders(<PromotionBatchesScreen />);
    await screen.findByText("batch-1");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    // Await the second page's own row, not the request: Previous is guarded while
    // a page is still in flight, so the click below has to land after it settles.
    expect(await screen.findByText("batch-2")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Previous" }));

    expect(await screen.findByText("batch-1")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();
  });
});
