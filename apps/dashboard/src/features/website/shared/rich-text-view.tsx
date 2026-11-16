"use client";

import { useTranslations } from "next-intl";
import { ImageIcon } from "lucide-react";

import { isKnownBlockType, toRichText, type HeadingLevel, type RichTextBlock } from "./rich-text";

const HEADING_CLASS = "font-semibold text-foreground";

/** A block's level (2–4, as the site renders it) inside the sheet, whose own section heading is
 * an `h3`: each sits below it, so the page's outline stays in order. */
const HEADING_TAG: Readonly<Record<HeadingLevel, "h4" | "h5" | "h6">> = {
  2: "h4",
  3: "h5",
  4: "h6",
};

function Block({ block }: { block: RichTextBlock }) {
  const t = useTranslations("website.content.richText");
  switch (block.type) {
    case "paragraph":
      return <p className="whitespace-pre-wrap">{block.text}</p>;
    case "heading": {
      const Heading = HEADING_TAG[block.level];
      return <Heading className={HEADING_CLASS}>{block.text}</Heading>;
    }
    case "list": {
      const List = block.ordered ? "ol" : "ul";
      return (
        <List className={block.ordered ? "list-decimal ps-5" : "list-disc ps-5"}>
          {block.items.map((item, index) => (
            // Lines may repeat and carry no id; their place is their identity here.
            <li key={index}>{item}</li>
          ))}
        </List>
      );
    }
    case "quote":
      return (
        <blockquote className="border-s-2 border-border ps-3 text-muted-foreground italic">
          {block.text}
        </blockquote>
      );
    case "image":
      return (
        <p className="flex items-center gap-2 text-muted-foreground">
          <ImageIcon className="size-4" aria-hidden="true" />
          {block.alt ? t("imageWithAlt", { alt: block.alt }) : t("image")}
        </p>
      );
  }
}

/**
 * A rich-text document read-only, as plain elements (decision 5: never `dangerouslySetInnerHTML`).
 * A block of an unknown type is named, not dropped. Headings sit one level below the sheet's own.
 */
export function RichTextView({ value }: { value: unknown }) {
  const t = useTranslations("website");
  const { blocks } = toRichText(value);
  if (blocks.length === 0) {
    return <p className="text-sm text-muted-foreground">{t("content.richText.empty")}</p>;
  }
  return (
    <div className="flex flex-col gap-3 text-sm text-foreground">
      {blocks.map((block, index) => {
        // The stored document may hold a type a newer theme added; it is read as a string.
        const type: string = block.type;
        // Blocks carry no id; the document's order is their identity.
        return isKnownBlockType(type) ? (
          <Block key={index} block={block} />
        ) : (
          <p key={index} className="text-muted-foreground">
            {t("richText.unsupported.label", { type })}
          </p>
        );
      })}
    </div>
  );
}
