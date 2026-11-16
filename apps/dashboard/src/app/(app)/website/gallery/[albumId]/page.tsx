import { notFound } from "next/navigation";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { AlbumPage } from "@/features/website/gallery/album-page";
import { isUuid } from "@/lib/helpers";

// Next 16 hands `params` over as a promise. A segment that isn't a UUID can't name an album, so
// it is a 404 here rather than a request the API would refuse. The page is keyed by its album, so
// one album's dialogs and reorder state never carry over to another.
export default async function WebsiteGalleryAlbumPage({
  params,
}: {
  params: Promise<{ albumId: string }>;
}) {
  const { albumId } = await params;
  if (!isUuid(albumId)) notFound();

  return (
    <Container>
      <AlbumPage key={albumId} albumId={albumId} />
    </Container>
  );
}
