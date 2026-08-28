import { getTranslations } from "next-intl/server";
import type { ReactNode } from "react";

/** Centered, chrome-free shell for the unauthenticated routes. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("app");

  return (
    <main className="flex min-h-dvh flex-col items-center justify-center bg-muted px-4 py-12">
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <p className="font-heading text-xl font-semibold text-foreground">{t("name")}</p>
          <p className="text-sm text-muted-foreground">{t("tagline")}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
