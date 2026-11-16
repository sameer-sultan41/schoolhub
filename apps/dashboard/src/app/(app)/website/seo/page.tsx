import { Container } from "@/app/(app)/shell/partials/common/container";
import { SiteSeo } from "@/features/website/seo/site-seo";

// The site-wide SEO defaults; each page, post, event and album has its own from its editor.
// Shown with `website.seo.update`; the API enforces it.
export default function WebsiteSeoPage() {
  return (
    <Container>
      <SiteSeo />
    </Container>
  );
}
