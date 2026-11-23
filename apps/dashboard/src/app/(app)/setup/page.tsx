import { Suspense } from "react";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { SetupWizard } from "@/features/onboarding/setup-wizard";

// The onboarding wizard. It shows its steps only to someone who can act on one; the API enforces
// every write. The wizard reads `?step=` (`useSearchParams`), hence the Suspense boundary.
export default function SetupPage() {
  return (
    <Container>
      <Suspense>
        <SetupWizard />
      </Suspense>
    </Container>
  );
}
