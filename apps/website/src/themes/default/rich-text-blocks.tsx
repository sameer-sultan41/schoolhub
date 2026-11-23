import Image from "next/image";
import type { ReactNode } from "react";
import { z } from "zod";

/**
 * A rich-text block document (`{"blocks": [...]}`, website-cms plan decision 5) rendered as React
 * elements. Text is only ever a child string, never markup: there is no `dangerouslySetInnerHTML`
 * here, so stored content cannot inject HTML. A block that is unknown or malformed renders
 * nothing, so a newer block type never takes the page down.
 */

const paragraph = z.object({ type: z.literal("paragraph"), text: z.string() });
const heading = z.object({
  type: z.literal("heading"),
  level: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  text: z.string(),
});
const list = z.object({
  type: z.literal("list"),
  ordered: z.boolean(),
  items: z.array(z.string()),
});
const quote = z.object({ type: z.literal("quote"), text: z.string() });
// The API replaces the image block's `file_id` with `file_url` (its public file redirect).
const image = z.object({
  type: z.literal("image"),
  file_url: z.url({ protocol: /^https?$/ }),
  alt: z.string().default(""),
});

const block = z.discriminatedUnion("type", [paragraph, heading, list, quote, image]);
type Block = z.infer<typeof block>;

/** The document's shape; each block is validated on its own so one bad block drops only itself. */
export const richTextDocument = z.object({ blocks: z.array(z.unknown()) });

const HEADING_TAGS = { 2: "h2", 3: "h3", 4: "h4" } as const;
const HEADING_CLASSES = {
  2: "text-xl font-semibold",
  3: "text-lg font-semibold",
  4: "text-base font-semibold",
} as const;

function renderBlock(value: Block, key: string): ReactNode {
  switch (value.type) {
    case "paragraph":
      return (
        <p key={key} className="whitespace-pre-line">
          {value.text}
        </p>
      );
    case "heading": {
      // Levels 2-4 sit under the page's own h1 (the page, post or event title).
      const Tag = HEADING_TAGS[value.level];
      return (
        <Tag key={key} className={`font-heading text-foreground ${HEADING_CLASSES[value.level]}`}>
          {value.text}
        </Tag>
      );
    }
    case "list": {
      const Tag = value.ordered ? "ol" : "ul";
      return (
        <Tag key={key} className={`space-y-1 ps-6 ${value.ordered ? "list-decimal" : "list-disc"}`}>
          {value.items.map((item, index) => (
            <li key={`${key}-${index}`}>{item}</li>
          ))}
        </Tag>
      );
    }
    case "quote":
      return (
        <blockquote key={key} className="border-s-4 border-primary ps-4 italic">
          {value.text}
        </blockquote>
      );
    case "image":
      return (
        <Image
          key={key}
          src={value.file_url}
          alt={value.alt}
          width={1200}
          height={675}
          sizes="(min-width: 768px) 768px, 100vw"
          className="h-auto w-full rounded-[var(--sh-radius)]"
        />
      );
  }
}

/** Renders the document's blocks in order; anything that is not a block document renders nothing. */
export function RichTextBlocks({ document }: { document: unknown }) {
  const parsed = richTextDocument.safeParse(document);
  if (!parsed.success || parsed.data.blocks.length === 0) return null;

  const rendered = parsed.data.blocks.map((raw, index) => {
    const result = block.safeParse(raw);
    return result.success ? renderBlock(result.data, `block-${index}`) : null;
  });

  return <div className="space-y-4 text-pretty text-foreground/85">{rendered}</div>;
}
