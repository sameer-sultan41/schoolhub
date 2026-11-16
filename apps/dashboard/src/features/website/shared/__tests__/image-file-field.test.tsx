import { fireEvent, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { useForm } from "react-hook-form";
import { Form } from "@schoolhub/ui";

import { Services, type JsonSchema } from "@/services";
import { mocked } from "@/test-fixtures/list-screen";
import { renderWithProviders, stubObjectUrls } from "@/test-utils";

import { ImageFileField } from "../image-file-field";
import { UploadTrackerProvider, useUploadTracker } from "../upload-tracker";
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

  it("writes a late upload to the field's current path, not the one it was picked at", async () => {
    interface Values {
      blocks: { file_id: string }[];
    }
    const read = jest.fn<undefined, [Values]>();
    // The field's block moves from index 0 to 1 while its upload runs, as a reorder would.
    function MovingHost() {
      const form = useForm<Values>({
        defaultValues: { blocks: [{ file_id: "" }, { file_id: "" }] },
      });
      const tracker = useUploadTracker();
      const [index, setIndex] = useState(0);
      return (
        <UploadTrackerProvider value={tracker}>
          <Form {...form}>
            <ImageFileField form={form} name={`blocks.${index}.file_id`} label="Image" />
            <button
              type="button"
              onClick={() => {
                setIndex(1);
              }}
            >
              Move
            </button>
            <button
              type="button"
              onClick={() => {
                read(form.getValues());
              }}
            >
              Read
            </button>
          </Form>
        </UploadTrackerProvider>
      );
    }
    const user = userEvent.setup();
    const upload = pendingUpload();
    const { unmount } = renderWithProviders(<MovingHost />);

    await user.upload(screen.getByLabelText("Image"), PICKED);
    await user.click(screen.getByRole("button", { name: "Move" }));
    upload.finish(FILE_ID);
    await waitFor(() => {
      expect(screen.getByText("An image is on file.")).toBeInTheDocument();
    });
    await user.click(screen.getByRole("button", { name: "Read" }));

    expect(read).toHaveBeenCalledWith({ blocks: [{ file_id: "" }, { file_id: FILE_ID }] });
    // Unmounted before `afterEach` restores the URL stubs: the field revokes its preview.
    unmount();
  });

  it("holds moving and removing list items while an item's image uploads", async () => {
    const SLIDES = {
      type: "object",
      properties: {
        items: {
          type: "array",
          items: {
            type: "object",
            properties: {
              photo_file_id: { type: "string", minLength: 36, maxLength: 36, "x-widget": "image" },
              caption: { type: "string", maxLength: 100, "x-widget": "text" },
            },
          },
        },
      },
    } as JsonSchema;
    const user = userEvent.setup();
    const upload = pendingUpload();
    const onSave = jest.fn().mockResolvedValue(undefined);
    const { unmount } = renderWithProviders(
      <SchemaHost
        schema={SLIDES}
        content={{ items: [{ caption: "First" }, { caption: "Second" }] }}
        onSave={onSave}
      />,
    );

    const [firstPhoto] = screen.getAllByLabelText("Photo");
    if (!firstPhoto) throw new Error("no photo field");
    await user.upload(firstPhoto, PICKED);
    expect(screen.getByRole("button", { name: "Move item 1 down" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move item 2 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove item 1" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Remove item 2" })).toBeDisabled();

    upload.finish(FILE_ID);
    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Move item 1 down" })).toBeEnabled();
    });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        items: [{ photo_file_id: FILE_ID, caption: "First" }, { caption: "Second" }],
      });
    });
    unmount();
  });

  it("refuses to render outside an UploadTrackerProvider", () => {
    function Bare() {
      const form = useForm<{ image: string }>({ defaultValues: { image: "" } });
      return (
        <Form {...form}>
          <ImageFileField form={form} name="image" label="Image" />
        </Form>
      );
    }
    // React logs the thrown render error; the assertion is the throw itself.
    const logged = jest.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() => renderWithProviders(<Bare />)).toThrow(/UploadTrackerProvider/);
    logged.mockRestore();
  });
});
