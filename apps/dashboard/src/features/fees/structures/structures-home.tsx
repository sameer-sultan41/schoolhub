"use client";

import { useTranslations } from "next-intl";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { FEE_HEADS_URL_FILTERS } from "@/services/modules/fee-heads/fee-heads-constant";
import {
  FEE_STRUCTURES_URL_FILTERS,
  HEADS_TAB_ID,
  STRUCTURES_TAB_ID,
} from "@/services/modules/fee-structures/fee-structures-constant";
import { FeeHeadsTab } from "../heads/fee-heads-tab";
import { FeesTabs, type FeesTabSpec } from "../shared/fees-tabs";
import { StructuresTab } from "./structures-tab";

const SCOPED_KEYS = [
  ...Object.keys(FEE_STRUCTURES_URL_FILTERS),
  ...Object.keys(FEE_HEADS_URL_FILTERS),
];

/**
 * `/fees/structures`: title and the two sub-tabs, Structures (the default) and Fee heads, in
 * `?tab=`. Both read `fees.fee-structure.view`, which the section nav and the API gate the page on.
 */
export function StructuresHome() {
  const t = useTranslations("fees");

  const tabs: FeesTabSpec[] = [
    { id: STRUCTURES_TAB_ID, label: t("structures.tabs.structures"), content: <StructuresTab /> },
    { id: HEADS_TAB_ID, label: t("structures.tabs.heads"), content: <FeeHeadsTab /> },
  ];

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("structures.title")} description={t("structures.summary")} />
      </Toolbar>
      <FeesTabs tabs={tabs} label={t("structures.tabs.label")} scopedKeys={SCOPED_KEYS} />
    </>
  );
}
