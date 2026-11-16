import { z } from "zod";
import { RichTextBlocks, richTextDocument } from "@/themes/default/rich-text-blocks";
import type { SectionProps } from "@/themes/types";

const schema = z.object({ body: richTextDocument });

/** Free-form content: the theme's `rich_text` section, one block document. */
export function RichText({ section }: SectionProps) {
  const parsed = schema.safeParse(section.props);
  if (!parsed.success || parsed.data.body.blocks.length === 0) return null;

  return (
    <section className="mx-auto max-w-3xl px-6 py-16">
      <RichTextBlocks document={parsed.data.body} />
    </section>
  );
}
