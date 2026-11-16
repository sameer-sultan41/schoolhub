"use client";

import { useTranslations } from "next-intl";

import type { DnsRecord } from "@/services";
import { CopyButton } from "@/features/website/shared/copy-button";

/**
 * The records a domain needs at its DNS provider, each name and value with a copy button. The
 * API says which to keep (`keep_after_verification`); the wording is the dashboard's: keep the
 * CNAME, and the TXT can go once verified (kept, it must keep the token).
 */
export function DnsRecords({ records }: { records: readonly DnsRecord[] }) {
  const t = useTranslations("website.domains.dns");

  return (
    <section className="space-y-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold text-foreground">{t("title")}</h3>
        <p className="text-sm text-muted-foreground">{t("intro")}</p>
      </div>
      <ul className="space-y-3" aria-label={t("title")}>
        {records.map((record) => (
          <li
            key={`${record.type}:${record.name}`}
            aria-label={t("record", { type: record.type })}
            className="space-y-2 rounded-md border border-border p-3"
          >
            <p className="text-sm font-semibold text-foreground">{record.type}</p>
            <dl className="space-y-2">
              <RecordLine
                label={t("name")}
                value={record.name}
                copyLabel={t("copyName", { type: record.type })}
              />
              <RecordLine
                label={t("value")}
                value={record.value}
                copyLabel={t("copyValue", { type: record.type })}
              />
            </dl>
            <p className="text-xs text-muted-foreground">
              {record.keep_after_verification ? t("keep") : t("removable")}
            </p>
            {record.type.toUpperCase() === "CNAME" ? (
              <p className="text-xs text-muted-foreground">{t("directCname")}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}

function RecordLine({
  label,
  value,
  copyLabel,
}: {
  label: string;
  value: string;
  copyLabel: string;
}) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <dt className="w-14 shrink-0 text-xs text-muted-foreground">{label}</dt>
      <dd className="min-w-0 grow">
        <code dir="ltr" className="block text-sm break-all text-foreground">
          {value}
        </code>
      </dd>
      <dd className="shrink-0">
        <CopyButton value={value} label={copyLabel} />
      </dd>
    </div>
  );
}
