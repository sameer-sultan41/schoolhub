import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { Container } from "@/app/(app)/shell/partials/common/container";
import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { ContactInbox } from "@/features/website/inbox/contact-inbox";

// The website's contact messages. Shown with `website.contact-submission.view`; the API enforces
// it. The inbox reads the URL (`useSearchParams`), so it sits in a Suspense boundary: Next fails
// a production build for one without.
export default async function WebsiteInboxPage() {
  const t = await getTranslations("website.inbox");
  return (
    <>
      <Container>
        <Toolbar>
          <ToolbarHeading title={t("title")} description={t("summary")} />
        </Toolbar>
      </Container>
      <Container>
        <Suspense>
          <ContactInbox />
        </Suspense>
      </Container>
    </>
  );
}
