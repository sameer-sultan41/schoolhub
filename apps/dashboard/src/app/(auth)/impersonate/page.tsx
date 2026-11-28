import type { Metadata } from "next";
import { Suspense } from "react";
import { getTranslations } from "next-intl/server";
import { ImpersonationHandoff } from "@/features/auth/impersonation-handoff";

/** `no-referrer`: nothing on this page may tell another site where the visitor came from
 * (ADR-0033, ADR-0037). The code lives in the fragment, which a `Referer` never carries anyway.
 * The handoff reads `?ended`, so it sits in a Suspense boundary. */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.impersonation");
  return { title: t("metaTitle"), referrer: "no-referrer" };
}

export default function ImpersonatePage() {
  return (
    <Suspense>
      <ImpersonationHandoff />
    </Suspense>
  );
}
