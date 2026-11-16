import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useForm, type Resolver } from "react-hook-form";
import { z } from "zod";
import { Button, Form } from "@schoolhub/ui";

import { renderWithProviders } from "@/test-utils";

import {
  emptyRichText,
  richTextSchema,
  toRichTextPayload,
  type RichTextDocument,
} from "../rich-text";
import { RichTextBlocksField } from "../rich-text-blocks-field";
import { submitAfterUploads, UploadTrackerProvider, useUploadTracker } from "../upload-tracker";

jest.mock("@/services", () =>
  jest
    .requireActual<{
      servicesMock: (domains: Record<string, readonly string[]>) => unknown;
    }>("@/test-fixtures/services-mock")
    .servicesMock({ files: ["uploadFile"] }),
);

interface HostValues {
  body: RichTextDocument;
}

const MESSAGES = {
  required: "Required.",
  tooLong: (max: number) => `At most ${max}.`,
  imageRequired: "Choose an image.",
};

function Host({
  initial = emptyRichText(),
  onSave,
  documentError,
}: {
  initial?: RichTextDocument;
  onSave: (doc: RichTextDocument) => void;
  /** An error on the document's own path, as the resolver or a 422 sets it. */
  documentError?: string;
}) {
  const form = useForm<HostValues>({
    resolver: zodResolver(
      z.object({ body: richTextSchema(MESSAGES) }),
    ) as unknown as Resolver<HostValues>,
    defaultValues: { body: initial },
  });
  const tracker = useUploadTracker();
  useEffect(() => {
    if (documentError) form.setError("body", { type: "server", message: documentError });
  }, [documentError, form]);
  return (
    <UploadTrackerProvider value={tracker}>
      <Form {...form}>
        <form
          noValidate
          onSubmit={submitAfterUploads(tracker, (event) => {
            void form.handleSubmit((values) => {
              onSave(toRichTextPayload(values.body));
            })(event);
          })}
        >
          <RichTextBlocksField form={form} name="body" label="Body" />
          <Button type="submit" disabled={tracker.isUploading}>
            Save
          </Button>
        </form>
      </Form>
    </UploadTrackerProvider>
  );
}

describe("RichTextBlocksField", () => {
  it("saves an untouched editor as the empty document", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    renderWithProviders(<Host onSave={onSave} />);

    expect(screen.getByText("No content yet. Add a block to start.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ blocks: [] });
    });
  });

  it("adds, reorders and removes blocks", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    renderWithProviders(<Host onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Paragraph" }));
    await user.click(screen.getByRole("button", { name: "Add Heading" }));
    await user.click(screen.getByRole("button", { name: "Add List" }));
    const [paragraph, heading] = screen.getAllByRole("textbox", { name: "Text" });
    await user.type(paragraph as HTMLElement, "Our school opened in 1990.");
    await user.type(heading as HTMLElement, "History");
    await user.type(screen.getByRole("textbox", { name: "Items (one per line)" }), "One{Enter}Two");

    // The heading moves above the paragraph.
    await user.click(screen.getByRole("button", { name: "Move block 2 up" }));
    const blocks = within(screen.getByRole("group", { name: "Body" })).getAllByRole("listitem");
    expect(blocks.map((block) => block.getAttribute("aria-label"))).toEqual([
      "Block 1: Heading",
      "Block 2: Paragraph",
      "Block 3: List",
    ]);

    // The list goes.
    await user.click(screen.getByRole("button", { name: "Remove block 3" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        blocks: [
          { type: "heading", level: 2, text: "History" },
          { type: "paragraph", text: "Our school opened in 1990." },
        ],
      });
    });
  });

  it("disables moving the first block up and the last block down", async () => {
    const user = userEvent.setup();
    renderWithProviders(
      <Host
        initial={{
          blocks: [
            { type: "quote", text: "Learn." },
            { type: "paragraph", text: "Hi" },
          ],
        }}
        onSave={jest.fn()}
      />,
    );

    expect(screen.getByRole("button", { name: "Move block 1 up" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Move block 2 down" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move block 1 down" }));
    expect(
      screen
        .getAllByRole("textbox", { name: "Text" })
        .map((input) => (input as HTMLTextAreaElement).value),
    ).toEqual(["Hi", "Learn."]);
  });

  it("refuses an image block with no image, under that block's own field", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    renderWithProviders(<Host onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add Image" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Choose an image.")).toBeInTheDocument();
    expect(onSave).not.toHaveBeenCalled();
  });

  it("shows an over-long list line under the list's own field", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    renderWithProviders(
      <Host
        initial={{ blocks: [{ type: "list", ordered: false, items: ["Fine", "x".repeat(1001)] }] }}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    const items = screen.getByRole("textbox", { name: "Items (one per line)" });
    await waitFor(() => {
      expect(items).toHaveAccessibleDescription("At most 1000.");
    });
    expect(onSave).not.toHaveBeenCalled();
  });

  it("puts the block cap on the document itself, where the editor shows it", async () => {
    // Rendering 501 blocks is slow under jsdom, so the two halves are proved apart: the check
    // puts its issue on the document's own path, and a message there shows under the editor.
    const blocks = Array.from({ length: 501 }, () => ({ type: "paragraph", text: "" }));
    const result = richTextSchema(MESSAGES).safeParse({ blocks });
    expect(result.success).toBe(false);
    expect(result.error?.issues.map((issue) => [issue.path, issue.message])).toEqual([
      [[], "At most 500."],
    ]);

    renderWithProviders(<Host onSave={jest.fn()} documentError="At most 500." />);
    expect(await screen.findByText("At most 500.")).toBeInTheDocument();
  });

  it("drops blank lines from a list when saving", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    renderWithProviders(
      <Host
        initial={{ blocks: [{ type: "list", ordered: true, items: ["One", "", "  ", "Two", ""] }] }}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        blocks: [{ type: "list", ordered: true, items: ["One", "Two"] }],
      });
    });
  });

  it("keeps a block of an unknown type as it came, shown read-only and removable", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    const video = { type: "video", url: "https://video.example/1", caption: "Opening" };
    renderWithProviders(
      <Host
        initial={
          { blocks: [video, { type: "paragraph", text: "Hi" }] } as unknown as RichTextDocument
        }
        onSave={onSave}
      />,
    );

    expect(screen.getByText("Unsupported block (video)")).toBeInTheDocument();
    expect(screen.getByText(/can't be edited here/)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ blocks: [video, { type: "paragraph", text: "Hi" }] });
    });

    await user.click(screen.getByRole("button", { name: "Remove block 1" }));
    await user.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => {
      expect(onSave).toHaveBeenLastCalledWith({ blocks: [{ type: "paragraph", text: "Hi" }] });
    });
  });
});
