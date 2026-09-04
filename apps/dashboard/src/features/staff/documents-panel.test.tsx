import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { DocumentsPanel } from "@/features/staff/documents-panel";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn(), delete: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
}));

// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockGet = apiClient.get as jest.MockedFunction<typeof apiClient.get>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockPost = apiClient.post as jest.MockedFunction<typeof apiClient.post>;
// eslint-disable-next-line @typescript-eslint/unbound-method -- mocked jest.fn(), never bound to `this`
const mockDelete = apiClient.delete as jest.MockedFunction<typeof apiClient.delete>;
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

const DOCUMENT = {
  id: "doc1",
  staff_id: "st1",
  file_id: "f1",
  document_type: "contract",
  title: "Employment contract",
  notes: null,
  verification_status: "pending" as const,
  verified_by: null,
  verified_at: null,
  expires_at: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

describe("DocumentsPanel", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockDelete.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("renders the empty state when the staff member has no documents", async () => {
    mockGet.mockResolvedValue(apiResult([]));

    renderWithProviders(<DocumentsPanel staffId="st1" />);

    expect(await screen.findByText("No documents uploaded yet.")).toBeInTheDocument();
  });

  it("renders a document's title, type, and pending status", async () => {
    mockGet.mockResolvedValue(apiResult([DOCUMENT]));

    renderWithProviders(<DocumentsPanel staffId="st1" />);

    expect(await screen.findByText("Employment contract")).toBeInTheDocument();
    expect(screen.getByText(/Contract/)).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders the ApiError envelope when the documents query fails", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/x" }),
    );

    renderWithProviders(<DocumentsPanel staffId="st1" />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
  });

  it("shows a verified document's badge and expiry, with no verify/reject actions", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(
      apiResult([
        {
          ...DOCUMENT,
          verification_status: "verified" as const,
          expires_at: "2030-01-01",
        },
      ]),
    );

    renderWithProviders(<DocumentsPanel staffId="st1" />);

    expect(await screen.findByText("Verified")).toBeInTheDocument();
    expect(screen.getByText(/Expires 2030-01-01/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("shows a rejected document's badge", async () => {
    mockGet.mockResolvedValue(
      apiResult([{ ...DOCUMENT, verification_status: "rejected" as const }]),
    );

    renderWithProviders(<DocumentsPanel staffId="st1" />);

    expect(await screen.findByText("Rejected")).toBeInTheDocument();
  });

  it("only shows verify/reject actions to a caller with the verify permission", async () => {
    mockGet.mockResolvedValue(apiResult([DOCUMENT]));

    renderWithProviders(<DocumentsPanel staffId="st1" />);

    await screen.findByText("Employment contract");
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("verifies a pending document when 'Verify' is clicked", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([DOCUMENT]));
    mockPost.mockResolvedValue(apiResult({ ...DOCUMENT, verification_status: "verified" }));

    const user = userEvent.setup();
    renderWithProviders(<DocumentsPanel staffId="st1" />);

    const verifyButton = await screen.findByRole("button", { name: "Verify" });
    await user.click(verifyButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/staff-documents/doc1:verify", {
        decision: "verified",
      });
    });
  });

  it("rejects a pending document when 'Reject' is clicked", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([DOCUMENT]));
    mockPost.mockResolvedValue(apiResult({ ...DOCUMENT, verification_status: "rejected" }));

    const user = userEvent.setup();
    renderWithProviders(<DocumentsPanel staffId="st1" />);

    const rejectButton = await screen.findByRole("button", { name: "Reject" });
    await user.click(rejectButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/staff-documents/doc1:verify", {
        decision: "rejected",
      });
    });
  });

  it("deletes a document when 'Delete' is clicked", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([DOCUMENT]));
    mockDelete.mockResolvedValue(apiResult(null));

    const user = userEvent.setup();
    renderWithProviders(<DocumentsPanel staffId="st1" />);

    const deleteButton = await screen.findByRole("button", { name: "Delete" });
    await user.click(deleteButton);

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith("/staff-documents/doc1");
    });
  });

  it("requests a signed download URL and opens it when 'Download' is clicked", async () => {
    mockGet.mockResolvedValue(apiResult([DOCUMENT]));
    mockPost.mockResolvedValue(apiResult({ download_url: "https://storage.invalid/signed" }));
    const mockOpen = jest.fn();
    window.open = mockOpen;

    const user = userEvent.setup();
    renderWithProviders(<DocumentsPanel staffId="st1" />);

    const downloadButton = await screen.findByRole("button", { name: "Download" });
    await user.click(downloadButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/files/f1:download");
    });
    expect(mockOpen).toHaveBeenCalledWith(
      "https://storage.invalid/signed",
      "_blank",
      "noopener,noreferrer",
    );
  });

  it("uploads a document via the two-step flow from the dialog", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    const mockFetch = jest.fn().mockResolvedValue({ ok: true });
    global.fetch = mockFetch;
    mockPost.mockImplementation((path: string) => {
      if (path === "/files") {
        return Promise.resolve(
          apiResult({
            id: "f2",
            original_name: "contract.pdf",
            mime_type: "application/pdf",
            size_bytes: 3,
            purpose: "staff.document",
            status: "pending",
            visibility: "tenant",
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-01T00:00:00Z",
            upload_url: "https://storage.invalid/f2",
            upload_method: "PUT",
            headers: {},
            expires_at: "2026-04-01T00:15:00Z",
          }),
        );
      }
      if (path === "/files/f2:confirm")
        return Promise.resolve(apiResult({ id: "f2", status: "ready" }));
      if (path === "/staff/st1/documents") return Promise.resolve(apiResult({}));
      throw new Error(`unexpected path ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<DocumentsPanel staffId="st1" />);

    await user.click(await screen.findByRole("button", { name: "Upload document" }));

    const dialog = screen.getByRole("dialog");
    const file = new File(["hello"], "contract.pdf", { type: "application/pdf" });
    await user.upload(within(dialog).getByLabelText("File"), file);
    await user.type(within(dialog).getByLabelText("Title"), "Employment contract");
    await user.type(within(dialog).getByLabelText("Notes"), "Signed copy");
    await user.type(within(dialog).getByLabelText("Expires on"), "2030-01-01");
    await user.click(within(dialog).getByLabelText("Document type"));
    await user.click(await screen.findByRole("option", { name: "Resume" }));
    await user.click(within(dialog).getByRole("button", { name: "Upload document" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/staff/st1/documents", {
        file_id: "f2",
        document_type: "resume",
        title: "Employment contract",
        notes: "Signed copy",
        expires_at: "2030-01-01",
      });
    });
  });

  it("shows an error inside the dialog when registering the uploaded document fails", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    mockPost.mockImplementation((path: string) => {
      if (path === "/files") {
        return Promise.resolve(
          apiResult({
            id: "f2",
            original_name: "contract.pdf",
            mime_type: "application/pdf",
            size_bytes: 3,
            purpose: "staff.document",
            status: "pending",
            visibility: "tenant",
            created_at: "2026-04-01T00:00:00Z",
            updated_at: "2026-04-01T00:00:00Z",
            upload_url: "https://storage.invalid/f2",
            upload_method: "PUT",
            headers: {},
            expires_at: "2026-04-01T00:15:00Z",
          }),
        );
      }
      if (path === "/files/f2:confirm")
        return Promise.resolve(apiResult({ id: "f2", status: "ready" }));
      if (path === "/staff/st1/documents") {
        return Promise.reject(
          new ApiError({
            code: "domain_rule_violation",
            message: "not allowed",
            status: 422,
            url: "/staff/st1/documents",
          }),
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<DocumentsPanel staffId="st1" />);

    await user.click(await screen.findByRole("button", { name: "Upload document" }));

    const dialog = screen.getByRole("dialog");
    const file = new File(["hello"], "contract.pdf", { type: "application/pdf" });
    await user.upload(within(dialog).getByLabelText("File"), file);
    await user.type(within(dialog).getByLabelText("Title"), "Employment contract");
    await user.click(within(dialog).getByRole("button", { name: "Upload document" }));

    expect(await within(dialog).findByText(/isn't allowed right now/i)).toBeInTheDocument();
  });
});
