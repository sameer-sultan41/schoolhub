import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm } from "react-hook-form";
import { Form } from "@schoolhub/ui";

import { Services } from "@/services";
import { renderWithProviders, stubImageLoading, stubObjectUrls } from "@/test-utils";

import { PhotoUploadField, type PhotoUploadFieldValues } from "../photo-upload-field";

jest.mock("@/services", () => ({
  Services: { files: { uploadFile: jest.fn() } },
}));

const mockUploadFile = Services.files.uploadFile as jest.MockedFunction<
  typeof Services.files.uploadFile
>;

function TestHost({
  uploadPurpose = "guardian.photo",
  savedPhotoFileId,
  savedPhotoUrl,
  onUploadingChange = jest.fn(),
}: {
  uploadPurpose?: string;
  savedPhotoFileId?: string | null;
  savedPhotoUrl?: string | null;
  onUploadingChange?: (uploading: boolean) => void;
}) {
  const form = useForm<PhotoUploadFieldValues>({
    defaultValues: {
      first_name: "Ayesha",
      last_name: "Raza",
      photo_file_id: savedPhotoFileId ?? "",
    },
  });
  return (
    <Form {...form}>
      <PhotoUploadField
        form={form}
        uploadPurpose={uploadPurpose}
        savedPhotoFileId={savedPhotoFileId}
        savedPhotoUrl={savedPhotoUrl}
        onUploadStart={() => () => true}
        onUploadingChange={onUploadingChange}
      />
    </Form>
  );
}

describe("PhotoUploadField", () => {
  beforeEach(() => {
    mockUploadFile.mockReset();
  });

  it("uploads the picked file with the given purpose and sets photo_file_id on success", async () => {
    mockUploadFile.mockResolvedValue("file-123");
    const restoreObjectUrls = stubObjectUrls("blob:new-photo");
    // Unmounted before the stubs are restored: the field revokes its object URL on
    // unmount, and jsdom has no native revokeObjectURL for the restore to fall back to
    // (same ordering student-form-dialog.test.tsx's own `stubObjectUrls` cases use).
    const { unmount } = renderWithProviders(<TestHost uploadPurpose="guardian.photo" />);
    try {
      await userEvent.upload(
        screen.getByLabelText(/photo/i),
        new File(["x"], "photo.jpg", { type: "image/jpeg" }),
      );

      await waitFor(() => {
        expect(mockUploadFile).toHaveBeenCalledWith(expect.any(File), "guardian.photo");
      });
    } finally {
      unmount();
      restoreObjectUrls();
    }
  });

  it("shows the upload's real error message on failure", async () => {
    mockUploadFile.mockRejectedValue(
      new Error("'image/gif' is not allowed for 'guardian.photo' uploads."),
    );
    const restoreObjectUrls = stubObjectUrls("blob:rejected-photo");
    const { unmount } = renderWithProviders(<TestHost uploadPurpose="guardian.photo" />);
    try {
      // applyAccept: false — the input's own `accept="image/jpeg,image/png"` would
      // otherwise make userEvent silently drop a .gif file before it ever reaches
      // the component's change handler, which would test nothing: this case is about
      // the server's own rejection (the mocked uploadFile failure below), not the
      // client-side accept hint.
      await userEvent
        .setup({ applyAccept: false })
        .upload(
          screen.getByLabelText(/photo/i),
          new File(["x"], "photo.gif", { type: "image/gif" }),
        );

      expect(
        await screen.findByText("'image/gif' is not allowed for 'guardian.photo' uploads."),
      ).toBeInTheDocument();
    } finally {
      unmount();
      restoreObjectUrls();
    }
  });

  it("previews the saved photo when photo_file_id matches the saved record", () => {
    // jsdom never loads images, so Radix's `AvatarImage` would wait forever without this
    // stub (same `stubImageLoading` pattern `student-form-dialog.test.tsx` already uses).
    // Queried via a plain CSS selector, not `getByRole("img")`: the component's
    // `AvatarImage` sets `alt=""` deliberately (decorative — the fallback initials are
    // the real accessible content), which computes an accessibility role of
    // "presentation", not "img".
    const restoreImageLoading = stubImageLoading();
    const { container } = renderWithProviders(
      <TestHost savedPhotoFileId="file-1" savedPhotoUrl="https://storage.test/ayesha.png" />,
    );

    expect(container.querySelector("img")).toHaveAttribute(
      "src",
      "https://storage.test/ayesha.png",
    );
    restoreImageLoading();
  });
});
