import { draftMode } from "next/headers";
import { getPreviewToken } from "@/lib/preview";
import { COPY } from "@/themes/default/copy";

/**
 * Tells an editor they are looking at unpublished content, with the way out (Draft Mode only).
 * Draft Mode outlives the 600 s token cookie; once the token is gone the reads are public again,
 * so only the exit control stays.
 */
export async function PreviewBanner() {
  const { isEnabled } = await draftMode();
  if (!isEnabled) return null;
  const previewing = (await getPreviewToken()) !== null;

  return (
    <aside
      role="status"
      className="flex flex-wrap items-center justify-center gap-3 bg-foreground px-4 py-2 text-sm text-background"
    >
      {previewing ? (
        <>
          <strong className="font-semibold">{COPY.preview.label}</strong>
          <span>{COPY.preview.body}</span>
        </>
      ) : null}
      <form method="post" action="/api/preview/exit">
        <button type="submit" className="underline underline-offset-2">
          {COPY.preview.exit}
        </button>
      </form>
    </aside>
  );
}
