import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { PageDirectoryTable } from "@/features/website/pages/page-directory-table";
import { PagesToolbar } from "@/features/website/pages/pages-toolbar";

// The tab bar and sidebar hide this section from a viewer without `website.page.view`, and the
// API enforces. The table reads the URL (`useSearchParams`), so it sits in a Suspense boundary:
// Next fails a production build for one without.
export default function WebsitePagesPage() {
  return (
    <>
      <Container>
        <PagesToolbar />
      </Container>
      <Container>
        <Suspense>
          <PageDirectoryTable />
        </Suspense>
      </Container>
    </>
  );
}
