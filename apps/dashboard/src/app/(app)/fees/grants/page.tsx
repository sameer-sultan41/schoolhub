import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { GrantsHome } from "@/features/fees/grants/grants-home";

// The tab bar and sidebar hide this section from a viewer holding neither `fees.discount.view` nor
// `fees.fine.view`, each sub-tab shows only to a holder of its own key, and the API enforces. The
// page reads the URL (`useSearchParams`: its tab and list filters), so it sits in a Suspense
// boundary: Next fails a production build for one without.
export default function FeeGrantsPage() {
  return (
    <Container>
      <Suspense>
        <GrantsHome />
      </Suspense>
    </Container>
  );
}
