import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { MfaEnrollForm } from "@/features/auth/mfa-enroll-form";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("auth.mfa.enroll");
  return { title: t("metaTitle") };
}

export default function MfaEnrollPage() {
  return <MfaEnrollForm />;
}
