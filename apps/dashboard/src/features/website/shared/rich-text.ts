import { z } from "zod";

/**
 * The rich-text block document (decision 5; `website_cms/schemas/rich_text.json`): no markup at
 * all, so nothing here is ever rendered as HTML. The limits mirror the server schema, which is
 * what enforces them.
 */

export type HeadingLevel = 2 | 3 | 4;

export type RichTextBlock =
  | { type: "paragraph"; text: string }
  | { type: "heading"; level: HeadingLevel; text: string }
  | { type: "list"; ordered: boolean; items: string[] }
  | { type: "quote"; text: string }
  | { type: "image"; file_id?: string; alt?: string };

export type RichTextBlockType = RichTextBlock["type"];
export type ImageBlock = Extract<RichTextBlock, { type: "image" }>;

export interface RichTextDocument {
  blocks: RichTextBlock[];
}

export const RICH_TEXT_BLOCK_TYPES: readonly RichTextBlockType[] = [
  "paragraph",
  "heading",
  "list",
  "quote",
  "image",
];

export const HEADING_LEVELS: readonly HeadingLevel[] = [2, 3, 4];

export const RICH_TEXT_LIMITS = {
  blocks: 500,
  paragraph: 5000,
  heading: 300,
  quote: 2000,
  listItems: 100,
  listItem: 1000,
  alt: 300,
} as const;

export function emptyRichText(): RichTextDocument {
  return { blocks: [] };
}

export function newBlock(type: RichTextBlockType): RichTextBlock {
  switch (type) {
    case "heading":
      return { type, level: 2, text: "" };
    case "list":
      return { type, ordered: false, items: [] };
    case "image":
      return { type, file_id: "", alt: "" };
    case "quote":
      return { type, text: "" };
    case "paragraph":
      return { type, text: "" };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** A stored value as a document: anything that isn't one is the empty document. */
export function toRichText(value: unknown): RichTextDocument {
  if (!isRecord(value) || !Array.isArray(value.blocks)) return emptyRichText();
  return { blocks: value.blocks.filter(isRecord) as unknown as RichTextBlock[] };
}

/** The document as the API takes it: an image with no file keeps no `file_id: ""` (the API
 * refuses an empty id) and no empty `alt`. */
export function toRichTextPayload(doc: RichTextDocument): RichTextDocument {
  return {
    blocks: doc.blocks.map((block) => {
      if (block.type !== "image") return block;
      const image: ImageBlock = { type: "image" };
      if (block.file_id) image.file_id = block.file_id;
      if (block.alt) image.alt = block.alt;
      return image;
    }),
  };
}

export interface RichTextMessages {
  required: string;
  tooLong: (max: number) => string;
  imageRequired: string;
}

/** The client-side check of a document, keyed to the editor's own field paths. */
export function richTextSchema(messages: RichTextMessages) {
  const text = (max: number) => z.string().max(max, messages.tooLong(max));
  const block = z.discriminatedUnion("type", [
    z.object({ type: z.literal("paragraph"), text: text(RICH_TEXT_LIMITS.paragraph) }),
    z.object({
      type: z.literal("heading"),
      level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      text: text(RICH_TEXT_LIMITS.heading).min(1, messages.required),
    }),
    z.object({
      type: z.literal("list"),
      ordered: z.boolean(),
      items: z
        .array(text(RICH_TEXT_LIMITS.listItem))
        .max(RICH_TEXT_LIMITS.listItems, messages.tooLong(RICH_TEXT_LIMITS.listItems)),
    }),
    z.object({ type: z.literal("quote"), text: text(RICH_TEXT_LIMITS.quote) }),
    z.object({
      type: z.literal("image"),
      file_id: z.string().min(1, messages.imageRequired),
      alt: text(RICH_TEXT_LIMITS.alt).optional(),
    }),
  ]);
  return z.object({
    blocks: z.array(block).max(RICH_TEXT_LIMITS.blocks, messages.tooLong(RICH_TEXT_LIMITS.blocks)),
  });
}
