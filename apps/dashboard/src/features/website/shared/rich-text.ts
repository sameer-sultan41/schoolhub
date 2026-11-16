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

/** A block type this editor knows. The server may one day send another (a newer theme); such a
 * block is kept as it came and shown as unsupported, never dropped and never blocking Save. */
export function isKnownBlockType(type: unknown): type is RichTextBlockType {
  return typeof type === "string" && (RICH_TEXT_BLOCK_TYPES as readonly string[]).includes(type);
}

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
 * refuses an empty id) nor an empty `alt`; a list keeps no blank lines. Any other block,
 * one of an unknown type included, goes back as it came. */
export function toRichTextPayload(doc: RichTextDocument): RichTextDocument {
  return {
    blocks: doc.blocks.map((block) => {
      if (block.type === "list") {
        return { ...block, items: block.items.filter((item) => item.trim() !== "") };
      }
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

/**
 * The client-side check of a document, with every issue on a path the editor shows a message
 * for: a block's own inputs, a list's `items` as a whole (an over-long line or too many lines),
 * and the document itself (too many blocks). A block of an unknown type passes unchanged.
 */
export function richTextSchema(messages: RichTextMessages) {
  const text = (max: number) => z.string().max(max, messages.tooLong(max));
  const listItems = z.array(z.string()).superRefine((items, ctx) => {
    if (items.length > RICH_TEXT_LIMITS.listItems) {
      ctx.addIssue({ code: "custom", message: messages.tooLong(RICH_TEXT_LIMITS.listItems) });
    } else if (items.some((item) => item.length > RICH_TEXT_LIMITS.listItem)) {
      ctx.addIssue({ code: "custom", message: messages.tooLong(RICH_TEXT_LIMITS.listItem) });
    }
  });
  const known = z.discriminatedUnion("type", [
    z.object({ type: z.literal("paragraph"), text: text(RICH_TEXT_LIMITS.paragraph) }),
    z.object({
      type: z.literal("heading"),
      level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
      text: text(RICH_TEXT_LIMITS.heading).min(1, messages.required),
    }),
    z.object({ type: z.literal("list"), ordered: z.boolean(), items: listItems }),
    z.object({ type: z.literal("quote"), text: text(RICH_TEXT_LIMITS.quote) }),
    z.object({
      type: z.literal("image"),
      file_id: z.string().min(1, messages.imageRequired),
      alt: text(RICH_TEXT_LIMITS.alt).optional(),
    }),
  ]);
  // Each known block is checked on its own, its issues moved under its index; an unknown
  // one is left alone. The array itself passes through as it came, so nothing is reshaped.
  const blocks = z.array(z.unknown()).superRefine((items, ctx) => {
    items.forEach((block, index) => {
      if (typeof block !== "object" || block === null) return;
      if (!isKnownBlockType((block as { type?: unknown }).type)) return;
      const result = known.safeParse(block);
      if (result.success) return;
      for (const issue of result.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message, path: [index, ...issue.path] });
      }
    });
  });
  return z.object({ blocks }).superRefine((doc, ctx) => {
    // On the document, not `blocks`: the editor's own message sits on the document's path.
    if (doc.blocks.length > RICH_TEXT_LIMITS.blocks) {
      ctx.addIssue({ code: "custom", message: messages.tooLong(RICH_TEXT_LIMITS.blocks) });
    }
  });
}
