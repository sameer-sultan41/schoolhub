import { Container } from "@/app/(app)/shell/partials/common/container";
import { FeesSectionStub } from "@/features/fees/fees-section-stub";

// The tab bar and sidebar hide this section from a viewer without `fees.fee-structure.view`, and
// the API enforces. A placeholder until the structures screen replaces it.
export default function FeeStructuresPage() {
  return (
    <Container>
      <FeesSectionStub section="structures" />
    </Container>
  );
}
