import { ApiError } from "@schoolhub/api-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import messages from "../../../messages/en.json";
import { QualificationsPanel } from "@/features/staff/qualifications-panel";
import { usePermission } from "@/hooks/use-session";
import { apiClient } from "@/lib/auth";

jest.mock("@/lib/auth", () => ({
  apiClient: { get: jest.fn(), post: jest.fn() },
}));
jest.mock("@/hooks/use-session", () => ({
  usePermission: jest.fn(() => false),
  useAnyPermission: jest.fn(() => false),
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

const QUALIFICATION = {
  id: "q1",
  staff_id: "st1",
  qualification_type: "degree" as const,
  title: "B.Ed",
  institution: "University of Karachi",
  field_of_study: null,
  year_awarded: 2010,
  grade: null,
  document_file_id: null,
  verification_status: "pending" as const,
  verified_by: null,
  verified_at: null,
  created_at: "2026-04-01T00:00:00Z",
  updated_at: "2026-04-01T00:00:00Z",
};

describe("QualificationsPanel", () => {
  beforeEach(() => {
    mockGet.mockReset();
    mockPost.mockReset();
    mockUsePermission.mockReturnValue(false);
  });

  it("renders the empty state when the staff member has no qualifications", async () => {
    mockGet.mockResolvedValue(apiResult([]));

    renderWithProviders(<QualificationsPanel staffId="st1" />);

    expect(await screen.findByText("No qualifications added yet.")).toBeInTheDocument();
  });

  it("renders a qualification's title, type, institution, and pending status", async () => {
    mockGet.mockResolvedValue(apiResult([QUALIFICATION]));

    renderWithProviders(<QualificationsPanel staffId="st1" />);

    expect(await screen.findByText("B.Ed")).toBeInTheDocument();
    expect(screen.getByText(/Degree/)).toBeInTheDocument();
    expect(screen.getByText(/University of Karachi/)).toBeInTheDocument();
    expect(screen.getByText("Pending")).toBeInTheDocument();
  });

  it("renders the ApiError envelope when the qualifications query fails", async () => {
    mockGet.mockRejectedValue(
      new ApiError({ code: "server_error", message: "boom", status: 500, url: "/x" }),
    );

    renderWithProviders(<QualificationsPanel staffId="st1" />);

    expect(await screen.findByText(/went wrong on our side/i)).toBeInTheDocument();
  });

  it("shows a verified qualification's badge with no verify/reject actions", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(
      apiResult([{ ...QUALIFICATION, verification_status: "verified" as const }]),
    );

    renderWithProviders(<QualificationsPanel staffId="st1" />);

    expect(await screen.findByText("Verified")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("only shows verify/reject actions to a caller with the verify permission", async () => {
    mockGet.mockResolvedValue(apiResult([QUALIFICATION]));

    renderWithProviders(<QualificationsPanel staffId="st1" />);

    await screen.findByText("B.Ed");
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reject" })).not.toBeInTheDocument();
  });

  it("verifies a pending qualification when 'Verify' is clicked", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([QUALIFICATION]));
    mockPost.mockResolvedValue(apiResult({ ...QUALIFICATION, verification_status: "verified" }));

    const user = userEvent.setup();
    renderWithProviders(<QualificationsPanel staffId="st1" />);

    const verifyButton = await screen.findByRole("button", { name: "Verify" });
    await user.click(verifyButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/staff-qualifications/q1:verify", {
        decision: "verified",
      });
    });
  });

  it("rejects a pending qualification when 'Reject' is clicked", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([QUALIFICATION]));
    mockPost.mockResolvedValue(apiResult({ ...QUALIFICATION, verification_status: "rejected" }));

    const user = userEvent.setup();
    renderWithProviders(<QualificationsPanel staffId="st1" />);

    const rejectButton = await screen.findByRole("button", { name: "Reject" });
    await user.click(rejectButton);

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/staff-qualifications/q1:verify", {
        decision: "rejected",
      });
    });
  });

  it("adds a qualification without a document from the dialog", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    mockPost.mockImplementation((path: string) => {
      if (path === "/staff/st1/qualifications") return Promise.resolve(apiResult({}));
      throw new Error(`unexpected path ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<QualificationsPanel staffId="st1" />);

    await user.click(await screen.findByRole("button", { name: "Add qualification" }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "B.Ed");
    await user.type(within(dialog).getByLabelText("Institution"), "University of Karachi");
    await user.click(within(dialog).getByRole("button", { name: "Add qualification" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/staff/st1/qualifications", {
        qualification_type: "degree",
        title: "B.Ed",
        institution: "University of Karachi",
        field_of_study: null,
        year_awarded: null,
        grade: null,
        document_file_id: null,
      });
    });
  });

  it("adds a qualification with a chosen type, optional fields, and a supporting document", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    global.fetch = jest.fn().mockResolvedValue({ ok: true });
    mockPost.mockImplementation((path: string) => {
      if (path === "/files") {
        return Promise.resolve(
          apiResult({
            id: "f2",
            original_name: "diploma.pdf",
            mime_type: "application/pdf",
            size_bytes: 3,
            purpose: "staff.qualification",
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
      if (path === "/staff/st1/qualifications") return Promise.resolve(apiResult({}));
      throw new Error(`unexpected path ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<QualificationsPanel staffId="st1" />);

    await user.click(await screen.findByRole("button", { name: "Add qualification" }));

    const dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByLabelText("Qualification type"));
    await user.click(await screen.findByRole("option", { name: "Diploma" }));
    await user.type(within(dialog).getByLabelText("Title"), "Diploma in IT");
    await user.type(within(dialog).getByLabelText("Field of study"), "Networking");
    await user.type(within(dialog).getByLabelText("Year awarded"), "2015");
    await user.type(within(dialog).getByLabelText("Grade"), "A");
    const file = new File(["hi"], "diploma.pdf", { type: "application/pdf" });
    await user.upload(within(dialog).getByLabelText("Supporting document"), file);
    await user.click(within(dialog).getByRole("button", { name: "Add qualification" }));

    await waitFor(() => {
      expect(mockPost).toHaveBeenCalledWith("/staff/st1/qualifications", {
        qualification_type: "diploma",
        title: "Diploma in IT",
        institution: null,
        field_of_study: "Networking",
        year_awarded: 2015,
        grade: "A",
        document_file_id: "f2",
      });
    });
  });

  it("shows an error inside the dialog when adding a qualification fails", async () => {
    mockUsePermission.mockReturnValue(true);
    mockGet.mockResolvedValue(apiResult([]));
    mockPost.mockImplementation((path: string) => {
      if (path === "/staff/st1/qualifications") {
        return Promise.reject(
          new ApiError({
            code: "domain_rule_violation",
            message: "not allowed",
            status: 422,
            url: "/staff/st1/qualifications",
          }),
        );
      }
      throw new Error(`unexpected path ${path}`);
    });

    const user = userEvent.setup();
    renderWithProviders(<QualificationsPanel staffId="st1" />);

    await user.click(await screen.findByRole("button", { name: "Add qualification" }));

    const dialog = screen.getByRole("dialog");
    await user.type(within(dialog).getByLabelText("Title"), "B.Ed");
    await user.click(within(dialog).getByRole("button", { name: "Add qualification" }));

    expect(await within(dialog).findByText(/isn't allowed right now/i)).toBeInTheDocument();
  });
});
