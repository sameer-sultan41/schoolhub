import { getTranslations } from "next-intl/server";

import { Container } from "@/app/(app)/shell/partials/common/container";

// Placeholder: the screen lands in the next task. The tab bar and sidebar show this section to a
// holder of `communication.thread.view`, and the API enforces.
export default async function CommunicationMessagesPage() {
  const t = await getTranslations("communication.messages");
  return (
    <Container>
      <h1 className="text-lg font-semibold">{t("title")}</h1>
      <p className="text-sm text-muted-foreground">{t("summary")}</p>
    </Container>
  );
}
