import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";

/**
 * The one list of Fees & Finance sections, in tab order: tabs, the `/fees` landing and the
 * sidebar's children all derive from it, in the final order: Invoices, Counter, Payments, Grants,
 * Structures, Expenses, Ledger, Reports. Every tab is gated on the key its screen
 * needs (Grants: either of its two read keys, as each sub-tab has its own), so a viewer lands on
 * the first screen they may open.
 */
export const FEES_SECTIONS = [
  {
    href: Paths.FEES_INVOICES,
    labelKey: "nav.invoices",
    menuTitle: "Invoices",
    permission: "fees.invoice.view",
  },
  {
    href: Paths.FEES_COUNTER,
    labelKey: "nav.counter",
    menuTitle: "Counter",
    permission: "fees.payment.collect",
  },
  {
    href: Paths.FEES_PAYMENTS,
    labelKey: "nav.payments",
    menuTitle: "Payments",
    permission: "fees.payment.view",
  },
  {
    href: Paths.FEES_GRANTS,
    labelKey: "nav.grants",
    menuTitle: "Grants",
    permission: ["fees.discount.view", "fees.fine.view"],
  },
  {
    href: Paths.FEES_STRUCTURES,
    labelKey: "nav.structures",
    menuTitle: "Structures",
    permission: "fees.fee-structure.view",
  },
  {
    href: Paths.FEES_EXPENSES,
    labelKey: "nav.expenses",
    menuTitle: "Expenses",
    permission: "fees.expense.view",
  },
  {
    href: Paths.FEES_LEDGER,
    labelKey: "nav.ledger",
    menuTitle: "Ledger",
    permission: "fees.ledger.view",
  },
  {
    href: Paths.FEES_REPORTS,
    labelKey: "nav.reports",
    menuTitle: "Reports",
    permission: "fees.report.view",
  },
] as const satisfies readonly ModuleSection[];
