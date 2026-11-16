import { notFound } from "next/navigation";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { PageEditor } from "@/features/website/pages/page-editor";
import { isUuid } from "@/lib/helpers";

// Next 16 hands `params` over as a promise. A segment that isn't a UUID can't name a page, so it
// is a 404 here rather than a request the API would refuse. The editor is keyed by its page, so
// one page's unsaved sections never carry over to another.
export default async function WebsitePageEditorPage({
  params,
}: {
  params: Promise<{ pageId: string }>;
}) {
  const { pageId } = await params;
  if (!isUuid(pageId)) notFound();

  return (
    <Container>
      <PageEditor key={pageId} pageId={pageId} />
    </Container>
  );
}
