import { Container } from "@/app/(app)/shell/partials/common/container";
import { FeesSectionStub } from "@/features/fees/fees-section-stub";

// The tab bar and sidebar hide this section from a viewer without `fees.ledger.view`, and the
// API enforces. A placeholder until the ledger screen replaces it.
export default function LedgerPage() {
  return (
    <Container>
      <FeesSectionStub section="ledger" />
    </Container>
  );
}
