import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { AlbumDirectory } from "@/features/website/gallery/album-directory";
import { GalleryToolbar } from "@/features/website/gallery/gallery-toolbar";

// The tab bar and sidebar hide this section from a viewer without `website.page.view`, and the
// API enforces. The directory reads the URL (`useSearchParams`), so it sits in a Suspense
// boundary: Next fails a production build for one without.
export default function WebsiteGalleryPage() {
  return (
    <>
      <Container>
        <GalleryToolbar />
      </Container>
      <Container>
        <Suspense>
          <AlbumDirectory />
        </Suspense>
      </Container>
    </>
  );
}
