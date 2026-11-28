import { Container } from "@/app/(app)/shell/partials/common/container";
import { CustomDomains } from "@/features/website/domains/custom-domains";

// The school's custom domains. Shown with either domain key the list reads under; the API
// enforces each write's own key.
export default function WebsiteDomainsPage() {
  return (
    <Container>
      <CustomDomains />
    </Container>
  );
}
