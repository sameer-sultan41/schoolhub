"use client";

import { useTranslations } from "next-intl";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { useCurrentUser } from "@/hooks/use-current-user";
import { hasPermission } from "@/lib/permissions";
import { FeesTabs, type FeesTabSpec } from "@/features/fees/shared/fees-tabs";
import { DiscountsTab } from "./discounts-tab";
import { FinesTab } from "./fines-tab";
import {
  DISCOUNTS_TAB_ID,
  FINES_TAB_ID,
  GRANT_URL_FILTER_KEYS,
  SCHOLARSHIPS_TAB_ID,
} from "./grants-constant";
import { ScholarshipsTab } from "./scholarships-tab";

/**
 * `/fees/grants`: title and the sub-tabs Discounts, Scholarships and Fines, in `?tab=`. Each tab
 * shows only to a holder of its own read key: Discounts and Scholarships read with
 * `fees.discount.view`, Fines with `fees.fine.view`. The section itself shows to a holder of
 * either.
 */
export function GrantsHome() {
  const t = useTranslations("fees");
  const { data: user } = useCurrentUser();

  const tabs: FeesTabSpec[] = [
    ...(hasPermission(user, "fees.discount.view")
      ? [
          { id: DISCOUNTS_TAB_ID, label: t("grants.tabs.discounts"), content: <DiscountsTab /> },
          {
            id: SCHOLARSHIPS_TAB_ID,
            label: t("grants.tabs.scholarships"),
            content: <ScholarshipsTab />,
          },
        ]
      : []),
    ...(hasPermission(user, "fees.fine.view")
      ? [{ id: FINES_TAB_ID, label: t("grants.tabs.fines"), content: <FinesTab /> }]
      : []),
  ];

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("grants.title")} description={t("grants.summary")} />
      </Toolbar>
      <FeesTabs tabs={tabs} label={t("grants.tabs.label")} scopedKeys={GRANT_URL_FILTER_KEYS} />
    </>
  );
}
