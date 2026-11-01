import { Suspense } from "react";
import { getTranslations } from "next-intl/server";

import { Container } from "@/app/(app)/shell/partials/common/container";
import { MessagesScreen } from "@/features/communication/messages/messages-screen";

// The tab bar and sidebar show this section to a holder of `communication.thread.view`, and the
// API enforces. The screen reads `useSearchParams`, so it sits under a `Suspense` boundary.
export default async function CommunicationMessagesPage() {
  const t = await getTranslations("communication.messages");
  return (
    <Container>
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="mb-4 text-sm text-muted-foreground">{t("summary")}</p>
      <Suspense>
        <MessagesScreen />
      </Suspense>
    </Container>
  );
}
