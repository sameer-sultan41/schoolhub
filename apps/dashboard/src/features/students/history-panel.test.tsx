import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { HistoryPanel } from "@/features/students/history-panel";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({ apiClient: { get: jest.fn(), post: jest.fn() } }));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));
jest.mock("@/features/students/use-reference-data", () => ({
  useCampuses: () => ({ data: [{ id: "c1", name: "Main Campus" }] }),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
const mockUsePermission = usePermission as jest.MockedFunction<typeof usePermission>;

function apiResult<T>(data: T) {
  return { data, meta: undefined, requestId: null, status: 200 };
}

function renderWithProviders(ui: React.ReactElement) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      <QueryClientProvider client={queryClient}>{ui}</QueryClientProvider>
    </NextIntlClientProvider>,
  );
}

const REQUESTED_TRANSFER = {
  id: "t1",
  student_id: "s1",
  transfer_type: "inter_campus",
  from_campus_id: "c1",
  to_campus_id: "c2",
  external_school_name: null,
  reason: "Family relocation",
  status: "requested",
  effective_date: "2026-06-01",
  decided_by: null,
  decided_at: null,
  certificate_document_id: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

describe("HistoryPanel", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("renders the empty state for both the timeline and the transfers list", async () => {
    mockGet.mockResolvedValue(apiResult([]));

    renderWithProviders(<HistoryPanel studentId="s1" />);

    expect(await screen.findByText("No history yet.")).toBeInTheDocument();
    expect(screen.getByText("No transfers on record.")).toBeInTheDocument();
  });

  it("renders a requested transfer with approve/reject actions", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockImplementation((path: string) => {
      if (path === `/students/s1/history`) return Promise.resolve(apiResult([]));
      if (path === "/student-transfers") return Promise.resolve(apiResult([REQUESTED_TRANSFER]));
      throw new Error(`unexpected path ${path}`);
    });

    renderWithProviders(<HistoryPanel studentId="s1" />);

    expect(await screen.findByText("Family relocation")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reject" })).toBeInTheDocument();
  });

  it("approves a requested transfer", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockImplementation((path: string) => {
      if (path === `/students/s1/history`) return Promise.resolve(apiResult([]));
      if (path === "/student-transfers") return Promise.resolve(apiResult([REQUESTED_TRANSFER]));
      throw new Error(`unexpected path ${path}`);
    });
    mockPost.mockResolvedValue(apiResult({ ...REQUESTED_TRANSFER, status: "approved" }));

    const user = userEvent.setup();
    renderWithProviders(<HistoryPanel studentId="s1" />);

    const approveButton = await screen.findByRole("button", { name: "Approve" });
    await user.click(approveButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/student-transfers/t1:approve");
    });
  });

  it("requests a new transfer from the dialog", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    mockPost.mockResolvedValue(apiResult({}));

    const user = userEvent.setup();
    renderWithProviders(<HistoryPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Request transfer" }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Family relocation");
    await user.type(within(dialog).getByLabelText("Effective date"), "2026-06-01");
    await user.click(within(dialog).getByRole("button", { name: "Request transfer" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/student-transfers", {
        student_id: "s1",
        transfer_type: "inter_campus",
        from_campus_id: null,
        to_campus_id: null,
        external_school_name: null,
        reason: "Family relocation",
        effective_date: "2026-06-01",
      });
    });
  });
});
