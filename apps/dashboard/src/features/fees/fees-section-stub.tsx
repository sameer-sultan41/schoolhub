"use client";

import { useTranslations } from "next-intl";

/** A placeholder a Fees section shows until its screen lands; the screen replaces it. */
export function FeesSectionStub({ section }: { section: "structures" | "ledger" }) {
  const t = useTranslations("fees");
  return (
    <section className="space-y-2">
      <h1 className="text-lg font-semibold text-foreground">{t(`${section}.title`)}</h1>
      <p className="text-sm text-muted-foreground">{t("stub.body")}</p>
    </section>
  );
}
