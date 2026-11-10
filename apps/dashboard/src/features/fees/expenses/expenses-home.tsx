"use client";

import { useTranslations } from "next-intl";

import { Toolbar, ToolbarHeading } from "@/app/(app)/shell/toolbar";
import { FeesTabs, type FeesTabSpec } from "@/features/fees/shared/fees-tabs";
import { BudgetsTab } from "./budgets-tab";
import { CategoriesTab } from "./categories-tab";
import {
  BUDGETS_TAB_ID,
  CATEGORIES_TAB_ID,
  EXPENSES_PAGE_FILTER_KEYS,
  EXPENSES_TAB_ID,
} from "./expenses-constant";
import { ExpensesTab } from "./expenses-tab";

/**
 * `/fees/expenses`: title and the sub-tabs Expenses, Categories and Budgets, in `?tab=`. All
 * three read with `fees.expense.view`, the key the section itself is gated on; each tab gates
 * its own writes.
 */
export function ExpensesHome() {
  const t = useTranslations("fees");

  const tabs: FeesTabSpec[] = [
    { id: EXPENSES_TAB_ID, label: t("expenses.tabs.expenses"), content: <ExpensesTab /> },
    { id: CATEGORIES_TAB_ID, label: t("expenses.tabs.categories"), content: <CategoriesTab /> },
    { id: BUDGETS_TAB_ID, label: t("expenses.tabs.budgets"), content: <BudgetsTab /> },
  ];

  return (
    <>
      <Toolbar>
        <ToolbarHeading title={t("expenses.title")} description={t("expenses.summary")} />
      </Toolbar>
      <FeesTabs
        tabs={tabs}
        label={t("expenses.tabs.label")}
        scopedKeys={EXPENSES_PAGE_FILTER_KEYS}
      />
    </>
  );
}
