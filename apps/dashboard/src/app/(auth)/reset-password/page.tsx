import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ResetPasswordForm } from "@/features/auth/reset-password-form";

/** `no-referrer`, as on `/accept-invite` (ADR-0033). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.resetPassword");
  return { title: t("metaTitle"), referrer: "no-referrer" };
}

export default function ResetPasswordPage() {
  return <ResetPasswordForm />;
}
