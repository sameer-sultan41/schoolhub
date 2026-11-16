import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ApiError } from "@/services";
import { renderWithProviders } from "@/test-utils";

import { fromSchemaFormValues, schemaErrorPath, toSchemaFormValues } from "../schema-model";
import { FAQ, FILE_ID, HERO, KITCHEN_SINK, SchemaHost } from "./schema-test-support";

jest.mock("@/services", () =>
  jest
    .requireActual<{
      servicesMock: (domains: Record<string, readonly string[]>) => unknown;
    }>("@/test-fixtures/services-mock")
    .servicesMock({ files: ["uploadFile"] }),
);

function sectionError(field: string, issue: string) {
  return new ApiError({
    code: "domain_rule_violation",
    message: "This action violates a business rule.",
    status: 422,
    url: "/website-pages/p1/page-sections",
    details: [{ field, issue }],
  });
}

describe("SchemaFields", () => {
  it("renders an input for every widget of the subset", () => {
    renderWithProviders(<SchemaHost schema={KITCHEN_SINK} onSave={jest.fn()} />);

    expect(screen.getByRole("textbox", { name: "Heading" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Introduction" }).tagName).toBe("TEXTAREA");
    expect(screen.getByRole("textbox", { name: "Button link" })).toHaveAttribute(
      "inputmode",
      "url",
    );
    expect(screen.getByLabelText("Image")).toHaveAttribute("type", "file");
    expect(screen.getByRole("group", { name: "Body" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Paragraph" })).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: "Form" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "How many to show" })).toHaveAttribute(
      "inputmode",
      "numeric",
    );
    expect(screen.getByRole("switch", { name: "Featured" })).toBeInTheDocument();
    expect(screen.getByText("Tags")).toBeInTheDocument();
    // A property with an unknown widget falls back to a plain text input.
    expect(screen.getByRole("textbox", { name: "Nickname" })).toBeInTheDocument();
  });

  it("shows a required error through the field's own FormMessage", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn();
    renderWithProviders(<SchemaHost schema={HERO} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Save" }));

    const heading = screen.getByRole("textbox", { name: "Heading" });
    await waitFor(() => {
      expect(heading).toHaveAccessibleDescription("This field is required.");
    });
    expect(heading).toHaveAttribute("aria-invalid", "true");
    expect(onSave).not.toHaveBeenCalled();
  });

  it("checks bounds and safe links client-side", async () => {
    const user = userEvent.setup();
    renderWithProviders(<SchemaHost schema={KITCHEN_SINK} onSave={jest.fn()} />);

    await user.type(screen.getByRole("textbox", { name: "Heading" }), "Welcome");
    await user.type(screen.getByRole("textbox", { name: "Button link" }), "javascript:alert(1)");
    await user.type(screen.getByRole("textbox", { name: "How many to show" }), "99");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText(/Use an https:\/\/ link/)).toBeInTheDocument();
    expect(screen.getByText("Enter 60 or less.")).toBeInTheDocument();
  });

  it("ignores keywords outside the subset", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderWithProviders(<SchemaHost schema={KITCHEN_SINK} onSave={onSave} />);

    await user.type(screen.getByRole("textbox", { name: "Heading" }), "Welcome");
    // `pattern: "^z"` is not in the subset, so "abc" is not refused.
    await user.type(screen.getByRole("textbox", { name: "Nickname" }), "abc");
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith(
        expect.objectContaining({ heading: "Welcome", nickname: "abc", featured: false }),
      );
    });
  });

  it("maps a 422 keyed by JSON path onto the right item's field", async () => {
    const user = userEvent.setup();
    const onSave = jest
      .fn()
      .mockRejectedValue(sectionError("sections.0.items.1.answer", "Keep the answer shorter."));
    renderWithProviders(
      <SchemaHost
        schema={FAQ}
        content={{
          items: [
            { question: "When?", answer: "Monday." },
            { question: "Where?", answer: "The main hall." },
          ],
        }}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    const answers = await screen.findAllByRole("textbox", { name: "Answer" });
    await waitFor(() => {
      expect(answers[1]).toHaveAccessibleDescription("Keep the answer shorter.");
    });
    expect(answers[0]).not.toHaveAccessibleDescription();
    expect(screen.queryByTestId("form-error")).not.toBeInTheDocument();
  });

  it("lands an error for an item that no longer exists on the list itself", async () => {
    const user = userEvent.setup();
    const onSave = jest
      .fn()
      .mockRejectedValue(sectionError("sections.0.items.7.answer", "Unknown item."));
    renderWithProviders(
      <SchemaHost
        schema={FAQ}
        content={{ items: [{ question: "Q", answer: "A" }] }}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Unknown item.")).toBeInTheDocument();
    expect(screen.queryByTestId("form-error")).not.toBeInTheDocument();
  });

  it("folds a 422 with no input to land on into the form's own message", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockRejectedValue(sectionError("sections.0.colour", "Not allowed."));
    renderWithProviders(
      <SchemaHost
        schema={FAQ}
        content={{ items: [{ question: "Q", answer: "A" }] }}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByTestId("form-error")).toHaveTextContent("Not allowed.");
  });

  it("omits the image key entirely when there is no image", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SchemaHost
        schema={HERO}
        content={{ heading: "Welcome", image_file_id: FILE_ID }}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove image" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledTimes(1);
    });
    const saved = onSave.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(saved).toEqual({ heading: "Welcome" });
    expect("image_file_id" in saved).toBe(false);
  });

  it("adds, moves and removes items of an object list", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderWithProviders(<SchemaHost schema={FAQ} content={{}} onSave={onSave} />);

    await user.click(screen.getByRole("button", { name: "Add item" }));
    await user.click(screen.getByRole("button", { name: "Add item" }));
    const questions = screen.getAllByRole("textbox", { name: "Question" });
    const answers = screen.getAllByRole("textbox", { name: "Answer" });
    await user.type(questions[0] as HTMLElement, "First?");
    await user.type(answers[0] as HTMLElement, "One.");
    await user.type(questions[1] as HTMLElement, "Second?");
    await user.type(answers[1] as HTMLElement, "Two.");
    await user.click(screen.getByRole("button", { name: "Move item 2 up" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({
        items: [
          { question: "Second?", answer: "Two." },
          { question: "First?", answer: "One." },
        ],
      });
    });

    const item = screen.getByRole("group", { name: "Item 1" });
    await user.click(
      within(screen.getByRole("group", { name: "Item 2" })).getByRole("button", {
        name: "Remove item 2",
      }),
    );
    expect(item).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Item 2" })).not.toBeInTheDocument();
  });
});

describe("schema-model", () => {
  it("round-trips stored content, leaving empty optional values out", () => {
    const values = toSchemaFormValues(KITCHEN_SINK, { heading: "Hi", limit: 6, form: "contact" });

    expect(values).toMatchObject({
      heading: "Hi",
      intro: "",
      image_file_id: "",
      body: { blocks: [] },
      limit: "6",
      featured: false,
      tags: [],
    });
    expect(fromSchemaFormValues(KITCHEN_SINK, values)).toEqual({
      heading: "Hi",
      body: { blocks: [] },
      form: "contact",
      limit: 6,
      featured: false,
      tags: [],
    });
  });

  it("keeps stored keys the schema doesn't declare, at every level", () => {
    // Content saved under an older theme version: `layout` and `note` are no longer declared.
    const stored = {
      heading: "FAQ",
      layout: "two-column",
      items: [{ question: "Q", answer: "A", note: "internal" }],
    };

    expect(fromSchemaFormValues(FAQ, toSchemaFormValues(FAQ, stored))).toEqual(stored);
  });

  it("omits a declared image the user removed, keeping only undeclared keys", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SchemaHost
        schema={HERO}
        content={{ heading: "Hi", image_file_id: FILE_ID, legacy_layout: "wide" }}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Remove image" }));
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ heading: "Hi", legacy_layout: "wide" });
    });
  });

  it("sends an undeclared stored key back through a form's own resolver", async () => {
    const user = userEvent.setup();
    const onSave = jest.fn().mockResolvedValue(undefined);
    renderWithProviders(
      <SchemaHost
        schema={HERO}
        content={{ heading: "Hi", legacy_layout: "wide" }}
        onSave={onSave}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith({ heading: "Hi", legacy_layout: "wide" });
    });
  });

  it("resolves a server path to the input it belongs under", () => {
    const values = toSchemaFormValues(FAQ, { items: [{ question: "Q", answer: "A" }] });

    expect(schemaErrorPath(FAQ, "items.0.answer", values)).toBe("items.0.answer");
    expect(schemaErrorPath(FAQ, "items.0", values)).toBe("items");
    expect(schemaErrorPath(FAQ, "items.3.answer", values)).toBe("items");
    expect(schemaErrorPath(FAQ, "heading.extra", values)).toBe("heading");
    expect(schemaErrorPath(FAQ, "nope", values)).toBeUndefined();
    expect(schemaErrorPath(FAQ, "non_field", values)).toBeUndefined();
    expect(
      schemaErrorPath(KITCHEN_SINK, "body.blocks.0.text", {
        body: { blocks: [{ type: "paragraph", text: "" }] },
      }),
    ).toBe("body.blocks.0.text");
    // The block has no `file_id`, so the error lands on the editor itself.
    expect(
      schemaErrorPath(KITCHEN_SINK, "body.blocks.0.file_id", {
        body: { blocks: [{ type: "paragraph", text: "" }] },
      }),
    ).toBe("body");
  });
});
