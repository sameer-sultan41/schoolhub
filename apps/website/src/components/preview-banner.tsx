import { getPreviewToken } from "@/lib/preview";
import { COPY } from "@/themes/default/copy";

/**
 * Tells an editor they are looking at unpublished content, with the way out, while the preview
 * cookie is held. Once it expires the reads are public again and the banner goes with it.
 */
export async function PreviewBanner() {
  if ((await getPreviewToken()) === null) return null;

  return (
    <aside
      role="status"
      className="flex flex-wrap items-center justify-center gap-3 bg-foreground px-4 py-2 text-sm text-background"
    >
      <strong className="font-semibold">{COPY.preview.label}</strong>
      <span>{COPY.preview.body}</span>
      <form method="post" action="/api/preview/exit">
        <button type="submit" className="underline underline-offset-2">
          {COPY.preview.exit}
        </button>
      </form>
    </aside>
  );
}
