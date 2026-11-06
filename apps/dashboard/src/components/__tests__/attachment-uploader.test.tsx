import { useState } from "react";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { renderWithProviders } from "@/test-utils";

import { AttachmentUploader, type UploadedAttachment } from "../attachment-uploader";

jest.mock("@/services", () =>
  jest
    .requireActual<{ servicesMock: (domains: Record<string, string[]>) => unknown }>(
      "@/test-fixtures/services-mock",
    )
    .servicesMock({ files: ["uploadFile"] }),
);

const PURPOSE = "attendance.leave-attachment";
const pdf = (name = "note.pdf") => new File(["x"], name, { type: "application/pdf" });

function Host({
  initial = [],
  multiple = false,
  maxFiles = 1,
}: {
  initial?: UploadedAttachment[];
  multiple?: boolean;
  maxFiles?: number;
}) {
  const [value, setValue] = useState(initial);
  return (
    <AttachmentUploader
      purpose={PURPOSE}
      label="Document"
      value={value}
      onChange={setValue}
      multiple={multiple}
      maxFiles={maxFiles}
    />
  );
}

describe("AttachmentUploader", () => {
  beforeEach(() => {
    mocked(Services.files.uploadFile).mockReset();
  });

  it("refuses a file over the size limit without uploading it", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Host />);
    const big = pdf("big.pdf");
    Object.defineProperty(big, "size", { value: 11 * 1024 * 1024 });

    await user.upload(screen.getByLabelText("Document"), big);

    expect(await screen.findByRole("alert")).toHaveTextContent("big.pdf is larger than 10 MB.");
    expect(Services.files.uploadFile).not.toHaveBeenCalled();
  });

  it("lists an uploaded file and removes it", async () => {
    mocked(Services.files.uploadFile).mockResolvedValue("file-1");
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    await user.upload(screen.getByLabelText("Document"), pdf());
    await screen.findByText("note.pdf");
    await user.click(screen.getByRole("button", { name: "Remove note.pdf" }));

    await waitFor(() => {
      expect(screen.queryByText("note.pdf")).not.toBeInTheDocument();
    });
  });

  it("shows the server's refusal text when the upload fails", async () => {
    mocked(Services.files.uploadFile).mockRejectedValue(new Error("Quarantined."));
    const user = userEvent.setup();
    renderWithProviders(<Host />);

    await user.upload(screen.getByLabelText("Document"), pdf());

    expect(await screen.findByRole("alert")).toHaveTextContent("Quarantined.");
  });

  it("stops offering the picker once a multiple list is full", () => {
    renderWithProviders(
      <Host
        multiple
        maxFiles={2}
        initial={[
          { id: "a", name: "a.pdf" },
          { id: "b", name: "b.pdf" },
        ]}
      />,
    );

    expect(screen.getByText("You can attach at most 2 files.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Document")).not.toBeInTheDocument();
  });
});
