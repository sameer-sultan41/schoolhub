import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";

/**
 * The one list of Fees & Finance sections, in tab order: tabs, the `/fees` landing and the
 * sidebar's children all derive from it. Final order: Invoices, Counter, Payments, Grants,
 * Structures, Expenses, Ledger, Reports; the later PRs insert their own sections in that place
 * (this PR ships Structures and Ledger only). Every tab is gated on the key its screen needs, so
 * a viewer lands on the first screen they may open.
 */
export const FEES_SECTIONS = [
  {
    href: Paths.FEES_STRUCTURES,
    labelKey: "nav.structures",
    menuTitle: "Structures",
    permission: "fees.fee-structure.view",
  },
  {
    href: Paths.FEES_LEDGER,
    labelKey: "nav.ledger",
    menuTitle: "Ledger",
    permission: "fees.ledger.view",
  },
] as const satisfies readonly ModuleSection[];
