import { ApiError } from "@schoolhub/api-client";
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

const ENROLLMENT_EVENT = {
  type: "enrollment" as const,
  id: "enr1",
  date: "2026-04-05",
  status: "active",
  academic_session_id: "sess1",
  academic_session_name: "2026-27",
  class_id: "class1",
  class_name: "Grade 6",
  section_id: "section1",
  section_name: "A",
  roll_number: "12",
};

const TRANSFER_EVENT = {
  type: "transfer" as const,
  id: "tr1",
  date: "2026-05-01",
  status: "completed",
  transfer_type: "inter_campus" as const,
  from_campus_id: "c1",
  from_campus_name: "Main Campus",
  to_campus_id: "c2",
  to_campus_name: "North Campus",
  external_school_name: null,
  reason: "Family relocation",
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

  it("rejects a requested transfer", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockImplementation((path: string) => {
      if (path === `/students/s1/history`) return Promise.resolve(apiResult([]));
      if (path === "/student-transfers") return Promise.resolve(apiResult([REQUESTED_TRANSFER]));
      throw new Error(`unexpected path ${path}`);
    });
    mockPost.mockResolvedValue(apiResult({ ...REQUESTED_TRANSFER, status: "rejected" }));

    const user = userEvent.setup();
    renderWithProviders(<HistoryPanel studentId="s1" />);

    const rejectButton = await screen.findByRole("button", { name: "Reject" });
    await user.click(rejectButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/student-transfers/t1:reject");
    });
  });

  it("renders enrollment and transfer timeline events, and a completed transfer's badge", async () => {
    mockGet.mockImplementation((path: string) => {
      if (path === `/students/s1/history`) {
        return Promise.resolve(apiResult([ENROLLMENT_EVENT, TRANSFER_EVENT]));
      }
      if (path === "/student-transfers") {
        return Promise.resolve(apiResult([{ ...REQUESTED_TRANSFER, status: "completed" }]));
      }
      throw new Error(`unexpected path ${path}`);
    });

    renderWithProviders(<HistoryPanel studentId="s1" />);

    expect(await screen.findByText(/Enrolled/)).toBeInTheDocument();
    expect(screen.getByText(/Grade 6/)).toBeInTheDocument();
    expect(screen.getByText(/Transfer — Inter-campus/)).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
  });

  it("shows the Complete action for an approved inter-campus transfer, and submits a section id", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockImplementation((path: string) => {
      if (path === `/students/s1/history`) return Promise.resolve(apiResult([]));
      if (path === "/student-transfers") {
        return Promise.resolve(apiResult([{ ...REQUESTED_TRANSFER, status: "approved" }]));
      }
      throw new Error(`unexpected path ${path}`);
    });
    mockPost.mockResolvedValue(apiResult({}));

    const user = userEvent.setup();
    renderWithProviders(<HistoryPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Complete" }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Section"), "section2");
    await user.click(within(dialog).getByRole("button", { name: "Complete" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/student-transfers/t1:complete", {
        section_id: "section2",
      });
    });
  });

  it("hides the destination-section field for a non-inter-campus transfer completion", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockImplementation((path: string) => {
      if (path === `/students/s1/history`) return Promise.resolve(apiResult([]));
      if (path === "/student-transfers") {
        return Promise.resolve(
          apiResult([{ ...REQUESTED_TRANSFER, transfer_type: "outgoing", status: "approved" }]),
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<HistoryPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Complete" }));

    expect(within(screen.getByRole("dialog")).queryByLabelText("Section")).not.toBeInTheDocument();
  });

  it("switches the transfer-type fields when requesting an outgoing transfer", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    mockPost.mockResolvedValue(apiResult({}));

    const user = userEvent.setup();
    renderWithProviders(<HistoryPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Request transfer" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("combobox", { name: "Transfer type" }));
    await user.click(await screen.findByRole("option", { name: "Outgoing" }));

    expect(within(dialog).getByLabelText("From campus")).toBeInTheDocument();
    expect(within(dialog).queryByLabelText("To campus")).not.toBeInTheDocument();
    expect(within(dialog).getByLabelText("External school name")).toBeInTheDocument();

    await user.type(within(dialog).getByLabelText("External school name"), "Greenfield Academy");
    await user.type(within(dialog).getByLabelText("Reason"), "Relocation");
    await user.type(within(dialog).getByLabelText("Effective date"), "2026-06-01");
    await user.click(within(dialog).getByRole("button", { name: "Request transfer" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/student-transfers", {
        student_id: "s1",
        transfer_type: "outgoing",
        from_campus_id: null,
        to_campus_id: null,
        external_school_name: "Greenfield Academy",
        reason: "Relocation",
        effective_date: "2026-06-01",
      });
    });
  });

  it("shows an error inside the request-transfer dialog when the request fails", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    mockPost.mockRejectedValue(
      new ApiError({ code: "conflict", message: "conflict", status: 409, url: "/x" }),
    );

    const user = userEvent.setup();
    renderWithProviders(<HistoryPanel studentId="s1" />);

    await user.click(await screen.findByRole("button", { name: "Request transfer" }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Reason"), "Family relocation");
    await user.type(within(dialog).getByLabelText("Effective date"), "2026-06-01");
    await user.click(within(dialog).getByRole("button", { name: "Request transfer" }));

    expect(await within(dialog).findByText(/conflicts with the current data/i)).toBeInTheDocument();
  });

  it("renders the ApiError envelope when the history query fails", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/x" }),
    );

    renderWithProviders(<HistoryPanel studentId="s1" />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
  });
});
