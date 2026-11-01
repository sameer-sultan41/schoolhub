import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { Container } from "@/app/(app)/shell/partials/common/container";
import { OversightScreen } from "@/features/communication/oversight/oversight-screen";

// The tab bar and sidebar show this section to a holder of `communication.thread.oversee`, and
// the API enforces. The screen reads `useSearchParams`, so it sits under a `Suspense` boundary.
export default async function CommunicationOversightPage() {
  const t = await getTranslations("communication.oversight");
  return (
    <Container>
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t("summary")}</p>
      <Suspense>
        <OversightScreen />
      </Suspense>
    </Container>
  );
}
