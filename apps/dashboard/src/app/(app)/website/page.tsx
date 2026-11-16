import { Container } from "@/app/(app)/shell/partials/common/container";
import { WebsiteLanding } from "@/features/website/inventory/website-landing";

// The content inventory (module doc §13) for a viewer who may read website content; anyone
// else is sent to the first Website section they may open.
export default function WebsitePage() {
  return (
    <Container>
      <WebsiteLanding />
    </Container>
  );
}
