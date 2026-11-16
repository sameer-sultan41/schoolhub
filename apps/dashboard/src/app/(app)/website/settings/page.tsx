import { Container } from "@/app/(app)/shell/partials/common/container";
import { SiteSettings } from "@/features/website/settings/site-settings";
import { WebsiteReadGate } from "@/features/website/shared/website-read-gate";

// The site's status, theme, social links and analytics id. Shown with `website.settings.update`;
// the API enforces it.
// Its reads need `website.page.view`: `WebsiteReadGate` explains instead of reading without it.
export default function WebsiteSettingsPage() {
  return (
    <Container>
      <WebsiteReadGate>
        <SiteSettings />
      </WebsiteReadGate>
    </Container>
  );
}
