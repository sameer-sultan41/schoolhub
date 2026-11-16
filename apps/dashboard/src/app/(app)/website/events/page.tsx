import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { EventDirectory } from "@/features/website/events/event-directory";
import { EventToolbar } from "@/features/website/events/event-toolbar";

// The tab bar and sidebar hide this section from a viewer without `website.page.view`, and the
// API enforces. The directory reads the URL (`useSearchParams`), so it sits in a Suspense
// boundary: Next fails a production build for one without.
export default function WebsiteEventsPage() {
  return (
    <>
      <Container>
        <EventToolbar />
      </Container>
      <Container>
        <Suspense>
          <EventDirectory />
        </Suspense>
      </Container>
    </>
  );
}
