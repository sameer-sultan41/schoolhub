import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { Suspense } from "react";
import { MfaVerifyForm } from "@/features/auth/mfa-verify-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.mfa.verify");
  return { title: t("metaTitle") };
}

/** `MfaVerifyForm` reads `?next=`, so it sits behind a Suspense boundary to prerender. */
export default function MfaVerifyPage() {
  return (
    <Suspense fallback={<div className="h-64 animate-pulse rounded-[var(--sh-radius)] bg-muted" />}>
      <MfaVerifyForm />
    </Suspense>
  );
}
