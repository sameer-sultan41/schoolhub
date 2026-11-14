import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { LedgerHome } from "@/features/fees/ledger/ledger-home";

// The tab bar and sidebar hide this section from a viewer without `fees.ledger.view`, and the
// API enforces. The page reads the URL (`useSearchParams`: its tab and list filters), so it sits
// in a Suspense boundary: Next fails a production build for one without.
export default function LedgerPage() {
  return (
    <Container>
      <Suspense>
        <LedgerHome />
      </Suspense>
    </Container>
  );
}
