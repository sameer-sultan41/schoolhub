import { Container } from "@/app/(app)/shell/partials/common/container";
import { PlansSection } from "@/features/platform/plans/plans-section";

// Shown to a holder of `platform.plan.view`; the API enforces.
export default function PlatformPlansPage() {
  return (
    <Container>
      <PlansSection />
    </Container>
  );
}
