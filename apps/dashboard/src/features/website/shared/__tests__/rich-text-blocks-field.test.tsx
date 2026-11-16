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
}: {
  initial?: RichTextDocument;
  onSave: (doc: RichTextDocument) => void;
}) {
  const form = useForm<HostValues>({
    resolver: zodResolver(
      z.object({ body: richTextSchema(MESSAGES) }),
    ) as unknown as Resolver<HostValues>,
    defaultValues: { body: initial },
  });
  return (
    <Form {...form}>
      <form
        noValidate
        onSubmit={(event) => {
          void form.handleSubmit((values) => {
            onSave(toRichTextPayload(values.body));
          })(event);
        }}
      >
        <RichTextBlocksField form={form} name="body" label="Body" />
        <Button type="submit">Save</Button>
      </form>
    </Form>
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
});
