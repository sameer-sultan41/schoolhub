import { getTranslations } from "next-intl/server";
import Link from "next/link";
import type { ReactNode } from "react";
import { Card, CardContent } from "@schoolhub/ui";
import { toAbsoluteUrl } from "@/app/(app)/_metronic/helpers";

/**
 * Ported from the vendor Metronic Next.js template's app/(auth)/layouts/branded.tsx —
 * the real split-screen chrome its own /signin route renders inside, not the old
 * pre-Metronic dashboard's flat platform-branded box. Only the marketing copy is swapped
 * from hardcoded English for real i18n strings (auth.login.brandTitle/brandDescription);
 * everything else (image panel, logo, the form's Card) matches Metronic's own markup.
 */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("auth.login");

  return (
    <>
      <style>
        {`
          .branded-bg {
            background-image: url('${toAbsoluteUrl("/media/images/2600x1600/1.png")}');
          }
          .dark .branded-bg {
            background-image: url('${toAbsoluteUrl("/media/images/2600x1600/1-dark.png")}');
          }
        `}
      </style>
      <div className="grid min-h-dvh lg:grid-cols-2">
        <div className="order-2 flex items-center justify-center p-8 lg:order-1 lg:p-10">
          <Card className="w-full max-w-[400px]">
            <CardContent className="p-6">{children}</CardContent>
          </Card>
        </div>

        <div className="branded-bg xxl:bg-center order-1 bg-top bg-no-repeat lg:order-2 lg:m-5 lg:rounded-xl lg:border lg:border-border xl:bg-cover">
          <div className="flex flex-col gap-4 p-8 lg:p-16">
            <Link href="/dashboard">
              <img
                src={toAbsoluteUrl("/media/app/mini-logo.svg")}
                className="h-[28px] max-w-none"
                alt=""
              />
            </Link>

            <div className="flex flex-col gap-3">
              <h3 className="text-mono text-2xl font-semibold">{t("brandTitle")}</h3>
              <div className="text-base font-medium text-secondary-foreground">
                {t("brandDescription")}
              </div>
            </div>
          </div>
        </div>
      </div>
    </>
  );
}
