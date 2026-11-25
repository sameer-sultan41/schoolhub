import { Button } from "@schoolhub/ui";

import { isPreviewServed } from "@/lib/preview";
import { COPY } from "@/themes/default/copy";

/**
 * Tells an editor they are looking at unpublished content, with the way out. It shows only when
 * this render's page was served as a preview, never for a junk or expired cookie or after the
 * read fell back to published content. Render it after the page read has settled.
 */
export function PreviewBanner() {
  if (!isPreviewServed()) return null;

  return (
    <aside
      role="status"
      className="flex flex-wrap items-center justify-center gap-3 bg-foreground px-4 py-2 text-sm text-background"
    >
      <strong className="font-semibold">{COPY.preview.label}</strong>
      <span>{COPY.preview.body}</span>
      <form method="post" action="/api/preview/exit">
        <Button type="submit" variant="inverse" mode="link" underline="solid">
          {COPY.preview.exit}
        </Button>
      </form>
    </aside>
  );
}
