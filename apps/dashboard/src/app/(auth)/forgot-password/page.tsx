import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

/** `no-referrer`, like the other emailed-link pages (ADR-0033). */
export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.forgotPassword");
  return { title: t("metaTitle"), referrer: "no-referrer" };
}

export default function ForgotPasswordPage() {
  return <ForgotPasswordForm />;
}
