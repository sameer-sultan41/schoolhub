import { Container } from "@/app/(app)/shell/partials/common/container";
import { SiteSettings } from "@/features/website/settings/site-settings";

// The site's status, theme, social links and analytics id. Shown with `website.settings.update`;
// the API enforces it.
export default function WebsiteSettingsPage() {
  return (
    <Container>
      <SiteSettings />
    </Container>
  );
}
