import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Services } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { renderWithProviders, stubObjectUrls } from "@/test-utils";

import { FILE_ID, HERO, SchemaHost } from "./schema-test-support";

jest.mock("@/services", () =>
  jest
    .requireActual<{
      servicesMock: (domains: Record<string, readonly string[]>) => unknown;
    }>("@/test-fixtures/services-mock")
    .servicesMock({ files: ["uploadFile"] }),
);

const uploadFile = mocked(Services.files.uploadFile);
const PICKED = new File(["x"], "hero.png", { type: "image/png" });

/** An upload that settles only when the test says so. */
function pendingUpload() {
  let finish: (id: string) => void = () => undefined;
  let fail: (error: Error) => void = () => undefined;
  uploadFile.mockReturnValue(
    new Promise<string>((resolve, reject) => {
      finish = resolve;
      fail = reject;
    }),
  );
  return {
    finish: (id: string) => {
      finish(id);
    },
    fail: (error: Error) => {
      fail(error);
    },
  };
}

describe("ImageFileField", () => {
  let restoreUrls: () => void;
  beforeEach(() => {
    restoreUrls = stubObjectUrls("blob:preview");
  });
  afterEach(() => {
    restoreUrls();
  });

  it("uploads with the website media purpose and stores the file id", async () => {
    const user = userEvent.setup();
    uploadFile.mockResolvedValue(FILE_ID);
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { unmount } = renderWithProviders(
      <SchemaHost schema={HERO} content={{ heading: "Hi" }} onSave={onSave} />,
    );

    await user.upload(screen.getByLabelText("Image"), PICKED);
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(uploadFile).toHaveBeenCalledWith(PICKED, "website.media");
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ heading: "Hi", image_file_id: FILE_ID });
    });
    unmount();
  });

  it("holds Save while uploading, and a submit that still gets through waits for the upload", async () => {
    const user = userEvent.setup();
    const upload = pendingUpload();
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { unmount } = renderWithProviders(
      <SchemaHost schema={HERO} content={{ heading: "Hi" }} onSave={onSave} />,
    );

    await user.upload(screen.getByLabelText("Image"), PICKED);
    const save = screen.getByRole("button", { name: "Save" });
    expect(save).toBeDisabled();
    expect(screen.getByText("Uploading…")).toBeInTheDocument();

    // A submit that gets past the disabled button (Enter in a text input, say).
    fireEvent.submit(save.closest("form") as HTMLFormElement);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onSave).not.toHaveBeenCalled();

    upload.finish(FILE_ID);
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ heading: "Hi", image_file_id: FILE_ID });
    });
    expect(onSave).toHaveBeenCalledTimes(1);
    unmount();
  });

  it("shows the upload's own error and keeps no file id", async () => {
    const user = userEvent.setup();
    const upload = pendingUpload();
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { unmount } = renderWithProviders(
      <SchemaHost schema={HERO} content={{ heading: "Hi" }} onSave={onSave} />,
    );

    await user.upload(screen.getByLabelText("Image"), PICKED);
    upload.fail(new Error("'image/png' is too large."));

    expect(await screen.findByRole("alert")).toHaveTextContent("'image/png' is too large.");
    expect(screen.getByText("No image.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ heading: "Hi" });
    });
    unmount();
  });
});
