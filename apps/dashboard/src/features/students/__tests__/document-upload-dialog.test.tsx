import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { DocumentUploadDialog } from "../document-upload-dialog";

jest.mock("@/services", () => ({
  ApiError: jest.requireActual<{ ApiError: unknown }>("@schoolhub/api-client").ApiError,
  Services: {
    files: { uploadFile: jest.fn() },
    students: { uploadDocumentRecord: jest.fn() },
  },
}));

const mockUploadFile = Services.files.uploadFile as jest.MockedFunction<
  typeof Services.files.uploadFile
>;
const mockUploadDocumentRecord = Services.students.uploadDocumentRecord as jest.MockedFunction<
  typeof Services.students.uploadDocumentRecord
>;

describe("DocumentUploadDialog", () => {
  const onOpenChange = jest.fn();
  const onUploaded = jest.fn();

  beforeEach(() => {
    mockUploadFile.mockReset();
    mockUploadDocumentRecord.mockReset();
    onOpenChange.mockReset();
    onUploaded.mockReset();
  });

  it("uploads the file then creates the document record with the chosen type and title", async () => {
    mockUploadFile.mockResolvedValue("file-1");
    mockUploadDocumentRecord.mockResolvedValue({ id: "d1" } as never);
    const user = userEvent.setup();

    renderWithProviders(
      <DocumentUploadDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onUploaded={onUploaded}
      />,
    );

    await user.upload(
      screen.getByLabelText(/^file$/i),
      new File(["x"], "birth-cert.pdf", { type: "application/pdf" }),
    );
    await user.click(screen.getByRole("combobox", { name: /document type/i }));
    await user.click(screen.getByRole("option", { name: /birth certificate/i }));
    await user.type(screen.getByLabelText(/^title$/i), "Birth certificate");
    await user.click(screen.getByRole("button", { name: /^upload document$/i }));

    await waitFor(() => {
      expect(mockUploadFile).toHaveBeenCalledWith(expect.any(File), "student.document");
    });
    await waitFor(() => {
      expect(mockUploadDocumentRecord).toHaveBeenCalledWith(
        "student-1",
        expect.objectContaining({
          fileId: "file-1",
          documentType: "birth_certificate",
          title: "Birth certificate",
        }),
      );
    });
    expect(onUploaded).toHaveBeenCalled();
  });

  it("shows the real step-specific error when the upload itself fails", async () => {
    class FakeUploadError extends Error {}
    mockUploadFile.mockRejectedValue(
      new FakeUploadError("The file could not be uploaded to storage."),
    );
    const user = userEvent.setup();

    renderWithProviders(
      <DocumentUploadDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onUploaded={onUploaded}
      />,
    );

    await user.upload(
      screen.getByLabelText(/^file$/i),
      new File(["x"], "doc.pdf", { type: "application/pdf" }),
    );
    await user.type(screen.getByLabelText(/^title$/i), "Doc");
    await user.click(screen.getByRole("button", { name: /^upload document$/i }));

    expect(
      await screen.findByText("The file could not be uploaded to storage."),
    ).toBeInTheDocument();
    expect(mockUploadDocumentRecord).not.toHaveBeenCalled();
    expect(onUploaded).not.toHaveBeenCalled();
  });

  it("blocks submission until a file and a title are both present", async () => {
    renderWithProviders(
      <DocumentUploadDialog
        open
        studentId="student-1"
        onOpenChange={onOpenChange}
        onUploaded={onUploaded}
      />,
    );

    await userEvent.setup().click(screen.getByRole("button", { name: /^upload document$/i }));

    expect(mockUploadFile).not.toHaveBeenCalled();
  });
});
