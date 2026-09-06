import { ApiError } from "@schoolhub/api-client";
import type { PermissionKey } from "@schoolhub/types";
import { screen } from "@testing-library/react";
import type { PromotionBatchRecord } from "@/features/academics/academics-types";
import type { SubstitutionRecord } from "@/features/timetable/timetable-types";
import { useSession } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { formatDate } from "@/lib/format";
import { apiResult, makeUser, renderWithProviders } from "@/test-utils";
import { PendingWorkPanel } from "./pending-work-panel";

jest.mock("@/hooks/use-session", () => ({ useSession: jest.fn() }));
jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn() } }));

const mockUseSession = useSession as jest.MockedFunction<typeof useSession>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;

const BOTH_KEYS: PermissionKey[] = ["timetable.substitution.approve", "academics.promotion.view"];

const SUBSTITUTION: SubstitutionRecord = {
  id: "sub-1",
  timetable_slot_id: "slot-1",
  date: "2026-09-09",
  absent_staff_id: "staff-1",
  substitute_staff_id: "staff-2",
  reason: "Sick leave",
  leave_request_id: null,
  status: "proposed",
  created_at: "2026-09-08T09:00:00Z",
  updated_at: "2026-09-08T09:00:00Z",
};

const BATCH: PromotionBatchRecord = {
  batch_id: "batch-7",
  from_academic_session_id: "sess-1",
  to_academic_session_id: "sess-2",
  from_class_id: "class-5",
  status: "pending_approval",
  students: 31,
  started_at: "2026-06-01",
};

function signIn(permissions: PermissionKey[]) {
  mockUseSession.mockReturnValue({
    user: makeUser({ permissions }),
    isLoading: false,
    isAuthenticated: true,
    isUnavailable: false,
    error: null,
    refetch: jest.fn(),
  });
}

function respond(substitutions: SubstitutionRecord[], batches: PromotionBatchRecord[]) {
  mockGet.mockImplementation((path: string) => {
    if (path === "/teacher-substitutions") return Promise.resolve(apiResult(substitutions));
    return Promise.resolve(apiResult(batches));
  });
}

describe("PendingWorkPanel", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockUseSession.mockReset();
    signIn(BOTH_KEYS);
  });

  it("renders nothing for a viewer who can act on neither queue", () => {
    signIn(["students.student.view"]);
    const { container } = renderWithProviders(<PendingWorkPanel />);

    expect(container).toBeEmptyDOMElement();
    expect(mockGet).not.toHaveBeenCalled();
  });

  it("shows placeholder rows while the queues are in flight", () => {
    mockGet.mockReturnValue(new Promise(() => undefined));
    const { container } = renderWithProviders(<PendingWorkPanel />);

    expect(screen.getByText("Waiting on you")).toBeInTheDocument();
    expect(container.querySelectorAll(".animate-pulse")).toHaveLength(3);
  });

  it("previews both queues and links each row to the screen that resolves it", async () => {
    respond([SUBSTITUTION], [BATCH]);
    renderWithProviders(<PendingWorkPanel />);

    const cover = await screen.findByText(`Cover on ${formatDate("2026-09-09", "en")}`);
    expect(cover).toBeInTheDocument();
    expect(screen.getByText("Sick leave")).toBeInTheDocument();
    expect(screen.getByText("31 students")).toBeInTheDocument();

    expect(screen.getByRole("link", { name: /31 students/ })).toHaveAttribute(
      "href",
      "/academics/promotions/batch-7",
    );
    expect(screen.getByRole("link", { name: "All substitutions" })).toHaveAttribute(
      "href",
      "/timetable/substitutions",
    );
  });

  it("only asks for the queue the viewer can act on", async () => {
    signIn(["academics.promotion.view"]);
    respond([], [BATCH]);

    renderWithProviders(<PendingWorkPanel />);

    await screen.findByText("Promotion batches awaiting approval");
    expect(screen.queryByText("Substitutions to approve")).not.toBeInTheDocument();
    expect(mockGet).toHaveBeenCalledTimes(1);
    expect(mockGet).toHaveBeenCalledWith("/student-promotions", {
      query: { status: "pending_approval", page_size: 5 },
    });
  });

  it("says a cover has no reason rather than leaving the line blank", async () => {
    respond([{ ...SUBSTITUTION, reason: null }], []);
    renderWithProviders(<PendingWorkPanel />);

    expect(await screen.findByText("No reason given")).toBeInTheDocument();
  });

  it("renders an empty state, not an error, when both queues are clear", async () => {
    respond([], []);
    renderWithProviders(<PendingWorkPanel />);

    expect(await screen.findByText("Nothing waiting on you")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("reports a failed read through the error envelope", async () => {
    mockGet.mockRejectedValue(
      new ApiError({
        code: "server_error",
        message: "boom",
        status: 500,
        url: "/teacher-substitutions",
      }),
    );

    renderWithProviders(<PendingWorkPanel />);

    expect(
      await screen.findByText("Something went wrong on our side. The team has been notified."),
    ).toBeInTheDocument();
  });
});
