import { Container } from "@/app/(app)/shell/partials/common/container";
import { FlagsSection } from "@/features/platform/feature-flags/flags-section";

// Shown to a holder of `platform.feature-flag.view`; the API enforces.
export default function PlatformFeatureFlagsPage() {
  return (
    <Container>
      <FlagsSection />
    </Container>
  );
}
