import { BUDGETS_URL_FILTER_KEYS } from "@/services/modules/budgets/budgets-constant";
import { EXPENSE_CATEGORIES_URL_FILTERS } from "@/services/modules/expense-categories/expense-categories-constant";
import { EXPENSES_URL_FILTER_KEYS } from "@/services/modules/expenses/expenses-constant";

/** The Expenses page's sub-tab ids, as `?tab=` carries them. Expenses is first, so it is the default and leaves the key out. */
export const EXPENSES_TAB_ID = "expenses";
export const CATEGORIES_TAB_ID = "categories";
export const BUDGETS_TAB_ID = "budgets";

/** The URL keys every tab's list owns (its filters), cleared on a tab change. */
export const EXPENSES_PAGE_FILTER_KEYS = [
  ...EXPENSES_URL_FILTER_KEYS,
  ...Object.keys(EXPENSE_CATEGORIES_URL_FILTERS),
  ...BUDGETS_URL_FILTER_KEYS,
];
