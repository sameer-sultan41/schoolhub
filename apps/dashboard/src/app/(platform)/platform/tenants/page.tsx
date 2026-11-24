import { Container } from "@/app/(app)/shell/partials/common/container";
import { TenantsSection } from "@/features/platform/tenants/tenants-section";

// Shown to a holder of `platform.tenant.view`; the API enforces.
export default function PlatformTenantsPage() {
  return (
    <Container>
      <TenantsSection />
    </Container>
  );
}
