import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AcceptInviteForm } from "@/features/auth/accept-invite-form";

/** `no-referrer`: nothing on this page may tell another site where the visitor came from
 * (ADR-0033). The token lives in the fragment, which a `Referer` never carries anyway. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.acceptInvite");
  return { title: t("metaTitle"), referrer: "no-referrer" };
}

export default function AcceptInvitePage() {
  return <AcceptInviteForm />;
}
