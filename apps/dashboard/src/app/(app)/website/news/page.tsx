import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { NewsDirectory } from "@/features/website/news/news-directory";
import { NewsToolbar } from "@/features/website/news/news-toolbar";

// The tab bar and sidebar hide this section from a viewer without `website.page.view`, and the
// API enforces. The directory reads the URL (`useSearchParams`), so it sits in a Suspense
// boundary: Next fails a production build for one without.
export default function WebsiteNewsPage() {
  return (
    <>
      <Container>
        <NewsToolbar />
      </Container>
      <Container>
        <Suspense>
          <NewsDirectory />
        </Suspense>
      </Container>
    </>
  );
}
