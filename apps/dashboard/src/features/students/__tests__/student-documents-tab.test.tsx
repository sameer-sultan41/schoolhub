import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import { Services } from "@/services";
import type { StudentDocumentRecord } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { StudentDocumentsTab } from "../student-documents-tab";

jest.mock("sonner", () => ({ toast: { error: jest.fn(), success: jest.fn() } }));

jest.mock("@/services", () => ({
  Services: {
    students: {
      fetchDocuments: jest.fn(),
      verifyDocument: jest.fn(),
      deleteDocument: jest.fn(),
      uploadDocumentRecord: jest.fn(),
      getDocumentDownloadUrl: jest.fn(),
    },
    files: { uploadFile: jest.fn() },
  },
}));

const mockFetchDocuments = Services.students.fetchDocuments as jest.MockedFunction<
  typeof Services.students.fetchDocuments
>;
const mockVerifyDocument = Services.students.verifyDocument as jest.MockedFunction<
  typeof Services.students.verifyDocument
>;
const mockDeleteDocument = Services.students.deleteDocument as jest.MockedFunction<
  typeof Services.students.deleteDocument
>;
const mockGetDocumentDownloadUrl = Services.students.getDocumentDownloadUrl as jest.MockedFunction<
  typeof Services.students.getDocumentDownloadUrl
>;
const mockToastError = toast.error as jest.MockedFunction<typeof toast.error>;

function documentRecord(overrides: Partial<StudentDocumentRecord> = {}): StudentDocumentRecord {
  return {
    id: "d1",
    student_id: "student-1",
    file_id: "file-1",
    document_type: "birth_certificate",
    // Deliberately NOT "Birth certificate" — that's the default type's own label
    // (`documents.type.birth_certificate`, `en.json`), rendered as a second, separate
    // text node in the same row. A title matching it would make `findByText` match two
    // elements and throw a multiple-elements error.
    title: "Ayesha's birth certificate",
    notes: null,
    verification_status: "pending",
    verified_by: null,
    verified_at: null,
    expires_at: null,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("StudentDocumentsTab", () => {
  beforeEach(() => {
    mockFetchDocuments.mockReset();
    mockVerifyDocument.mockReset();
    mockDeleteDocument.mockReset();
    mockGetDocumentDownloadUrl.mockReset();
    mockToastError.mockReset();
  });

  it("shows empty copy when there are no documents yet", async () => {
    mockFetchDocuments.mockResolvedValue([]);

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    expect(await screen.findByText(/no documents uploaded yet/i)).toBeInTheDocument();
  });

  it("shows verify/reject only for a pending document, and only when permitted", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord({ verification_status: "pending" })]);

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    await screen.findByText("Ayesha's birth certificate");
    // Prefix-anchored, not an exact match — the real button also carries a row-specific
    // accessible name (WCAG 2.4.6: "Verify — <document title>"), not just "Verify".
    expect(screen.getByRole("button", { name: /^verify/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^reject/i })).toBeInTheDocument();
  });

  it("hides verify/reject for an already-verified document", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord({ verification_status: "verified" })]);

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    await screen.findByText("Ayesha's birth certificate");
    expect(screen.queryByRole("button", { name: /^verify/i })).not.toBeInTheDocument();
  });

  it("requests a fresh signed URL on every download click, not a cached one", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord()]);
    mockGetDocumentDownloadUrl.mockResolvedValue("https://files.example.com/x?sig=abc");
    const user = userEvent.setup();

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    const button = await screen.findByRole("button", { name: /download/i });
    await user.click(button);
    await user.click(button);

    // Clicked twice, asserting two real calls (not one cached result reused) is what
    // actually pins "fetched fresh per click" — a signed URL has a server-side TTL, so
    // reusing one eventually hands out an expired link. The anchor-click mechanics are
    // `staff-toolbar.tsx`'s own already-proven pattern, reused verbatim here, not
    // re-tested per call site.
    await waitFor(() => {
      expect(mockGetDocumentDownloadUrl).toHaveBeenCalledTimes(2);
    });
    expect(mockGetDocumentDownloadUrl).toHaveBeenCalledWith("d1");
  });

  it("shows a toast when the download URL fetch fails", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord()]);
    mockGetDocumentDownloadUrl.mockRejectedValue(new Error("network down"));

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    await userEvent.setup().click(await screen.findByRole("button", { name: /download/i }));

    await waitFor(() => {
      expect(mockToastError).toHaveBeenCalled();
    });
  });

  it("confirms before deleting", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord()]);
    mockDeleteDocument.mockResolvedValue(undefined);
    const user = userEvent.setup();

    renderWithProviders(
      <StudentDocumentsTab studentId="student-1" canCreate canVerify canDelete />,
    );

    // Prefix-anchored — the row's own button carries a row-specific accessible name
    // ("Delete — <document title>", WCAG 2.4.6), not plain "Delete".
    await user.click(await screen.findByRole("button", { name: /^delete/i }));
    expect(mockDeleteDocument).not.toHaveBeenCalled();
    // Scoped to the open confirmation dialog: its own confirm button has no row-specific
    // suffix, so it's still exactly "Delete" — scoping (not the name) is what disambiguates
    // it from the row's trigger button.
    const confirmDialog = await screen.findByRole("alertdialog");
    await user.click(within(confirmDialog).getByRole("button", { name: /^delete$/i }));

    await waitFor(() => {
      expect(mockDeleteDocument).toHaveBeenCalledWith("d1");
    });
  });

  it("hides every gated action for a caller with none of the permissions", async () => {
    mockFetchDocuments.mockResolvedValue([documentRecord({ verification_status: "pending" })]);

    renderWithProviders(
      <StudentDocumentsTab
        studentId="student-1"
        canCreate={false}
        canVerify={false}
        canDelete={false}
      />,
    );

    await screen.findByText("Ayesha's birth certificate");
    expect(screen.queryByRole("button", { name: /upload document/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^verify/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^delete/i })).not.toBeInTheDocument();
    // Download has no permission gate (students.document.view already governs whether the
    // tab is reachable at all), so it stays visible.
    expect(screen.getByRole("button", { name: /download/i })).toBeInTheDocument();
  });
});
