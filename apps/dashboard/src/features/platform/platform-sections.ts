import type { ModuleSection } from "@/components/module-sections/module-sections";
import { Paths } from "@/config/paths";
import { PLATFORM_KEYS } from "./platform-permissions";

/** The console's sections, in tab order: the tabs, the `/platform` landing and the sidebar's
 * children all derive from this list, each gated on its own view key. */
export const PLATFORM_SECTIONS = [
  {
    href: Paths.PLATFORM_TENANTS,
    labelKey: "nav.tenants",
    menuTitle: "Tenants",
    permission: PLATFORM_KEYS.tenantView,
  },
  {
    href: Paths.PLATFORM_PLANS,
    labelKey: "nav.plans",
    menuTitle: "Plans",
    permission: PLATFORM_KEYS.planView,
  },
  {
    href: Paths.PLATFORM_FEATURE_FLAGS,
    labelKey: "nav.featureFlags",
    menuTitle: "Feature flags",
    permission: PLATFORM_KEYS.flagView,
  },
  {
    href: Paths.PLATFORM_REPORTS,
    labelKey: "nav.reports",
    menuTitle: "Reports",
    permission: PLATFORM_KEYS.reportView,
  },
] as const satisfies readonly ModuleSection[];
