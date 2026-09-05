import { ApiError, type ApiResult } from "@schoolhub/api-client";
import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SubstitutionsScreen } from "@/features/timetable/substitutions-screen";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";
import { renderWithProviders } from "@/test-utils";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), patch: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("next/navigation", () => ({ usePathname: () => "/timetable/substitutions" }));
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

function page(items: unknown[], nextCursor: string | null = null): ApiResult<unknown> {
  return {
    data: items,
    meta: { pagination: { next_cursor: nextCursor, previous_cursor: null, page_size: 25 } },
    requestId: "req-list",
    status: 200,
  };
}

describe("SubstitutionsScreen", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("resolves both teachers by name and shows the status", async () => {
    mockGet.mockResolvedValue(page([PROPOSED]));
    renderWithProviders(<SubstitutionsScreen />);

    expect(await screen.findByText("Bilal Ahmed")).toBeInTheDocument();
    expect(screen.getByText("Sana Iqbal")).toBeInTheDocument();
    expect(screen.getByText("2026-09-08")).toBeInTheDocument();
    expect(screen.getByText("Medical leave")).toBeInTheDocument();
    expect(screen.getByText("Proposed")).toBeInTheDocument();
  });

  it("shows the translated empty state", async () => {
    mockGet.mockResolvedValue(page([]));
    renderWithProviders(<SubstitutionsScreen />);

    expect(await screen.findByText("No substitutions found.")).toBeInTheDocument();
  });

  it("filters by status", async () => {
    mockGet.mockResolvedValue(page([PROPOSED]));
    const user = userEvent.setup();
    renderWithProviders(<SubstitutionsScreen />);
    await screen.findByText("Bilal Ahmed");

    await user.click(screen.getByRole("combobox", { name: "Status" }));
    await user.click(await screen.findByRole("option", { name: "Confirmed" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({ status: "confirmed" });
    });
  });

  it("filters by a date range", async () => {
    mockGet.mockResolvedValue(page([PROPOSED]));
    renderWithProviders(<SubstitutionsScreen />);
    await screen.findByText("Bilal Ahmed");

    fireEvent.change(screen.getByLabelText("From"), { target: { value: "2026-09-01" } });
    fireEvent.change(screen.getByLabelText("To"), { target: { value: "2026-09-30" } });

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query).toMatchObject({
        date_from: "2026-09-01",
        date_to: "2026-09-30",
      });
    });
  });

  it("pages forward by cursor", async () => {
    mockGet.mockResolvedValue(page([PROPOSED], "cursor-2"));
    renderWithProviders(<SubstitutionsScreen />);
    await screen.findByText("Bilal Ahmed");

    fireEvent.click(screen.getByRole("button", { name: "Next" }));

    await waitFor(() => {
      expect(mockGet.mock.calls.at(-1)?.[1]?.query?.cursor).toBe("cursor-2");
    });
  });

  it("hides the proposal form and the decision buttons without permission", async () => {
    mockGet.mockResolvedValue(page([PROPOSED]));
    renderWithProviders(<SubstitutionsScreen />);

    await screen.findByText("Bilal Ahmed");
    expect(screen.queryByTestId("substitution-form")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
  });

  it("offers a decision only on a proposal", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([CONFIRMED]));
    renderWithProviders(<SubstitutionsScreen />);

    await screen.findByText("Confirmed");
    expect(screen.queryByRole("button", { name: "Approve" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("approves a proposal", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(page([PROPOSED]));
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
    mockGet.mockResolvedValue(page([PROPOSED]));
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
    mockGet.mockResolvedValue(page([PROPOSED]));
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

  it("renders the error envelope instead of the table on failure", async () => {
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
    expect(screen.queryByRole("table")).not.toBeInTheDocument();
  });
});
