import { Container } from "@/app/(app)/shell/partials/common/container";
import { SiteSeo } from "@/features/website/seo/site-seo";
import { WebsiteReadGate } from "@/features/website/shared/website-read-gate";

// The site-wide SEO defaults; each page, post, event and album has its own from its editor.
// Shown with `website.seo.update`; the API enforces it.
// Its reads need `website.page.view`: `WebsiteReadGate` explains instead of reading without it.
export default function WebsiteSeoPage() {
  return (
    <Container>
      <WebsiteReadGate>
        <SiteSeo />
      </WebsiteReadGate>
    </Container>
  );
}
