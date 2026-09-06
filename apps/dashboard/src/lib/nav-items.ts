import type { PermissionKey } from "@schoolhub/types";
import {
  BookOpen,
  CalendarClock,
  ClipboardCheck,
  Globe,
  GraduationCap,
  LayoutDashboard,
  type LucideIcon,
  MessageSquare,
  UserRoundPlus,
  Users,
  Wallet,
} from "lucide-react";

/**
 * Navigation mirrors the module docs one-to-one. Each entry names the module it belongs to,
 * so the menu is filtered by the user's effective permissions — a teacher never sees the
 * payroll link. Server-side RBAC still enforces every one of these.
 */
export interface NavItem {
  /** Message key under the `nav` namespace, and the entry's identity in the menu. */
  key: string;
  href: string;
  /** Module whose permissions gate this entry; `""` means "everyone who is signed in". */
  module: string;
  icon: LucideIcon;
  /**
   * `"planned"` means the module is on the roadmap but has no route yet. The shell renders
   * those as disabled buttons rather than links: as links they resolve to a 404, which
   * reads as a broken app rather than as an unbuilt feature.
   */
  status: "ready" | "planned";
  permission?: PermissionKey;
}

export interface NavGroup {
  /** Message key under `nav.groups`. */
  key: string;
  items: NavItem[];
}

/**
 * Grouped rather than flat: ten undifferentiated entries make the sidebar a list to read
 * top-to-bottom every time, where four labelled groups let someone jump to the region
 * they want. The order runs from "where am I" outwards to the back office.
 *
 * Every group holds at least one entry that is never permission-filtered away (the
 * dashboard, or a `planned` entry), so no group can render empty — keep that true when
 * adding a group, or the shell will need an emptiness guard it does not have today.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    key: "overview",
    items: [
      { key: "dashboard", href: "/dashboard", module: "", icon: LayoutDashboard, status: "ready" },
    ],
  },
  {
    key: "people",
    items: [
      {
        key: "students",
        href: "/students",
        module: "students",
        icon: GraduationCap,
        status: "ready",
      },
      { key: "staff", href: "/staff", module: "staff", icon: Users, status: "ready" },
      {
        key: "admissions",
        href: "/admissions",
        module: "admissions",
        icon: UserRoundPlus,
        status: "planned",
      },
    ],
  },
  {
    key: "teaching",
    items: [
      {
        key: "academics",
        href: "/academics",
        module: "academics",
        icon: BookOpen,
        status: "ready",
      },
      {
        key: "timetable",
        href: "/timetable",
        module: "timetable",
        icon: CalendarClock,
        status: "ready",
      },
      {
        key: "attendance",
        href: "/attendance",
        module: "attendance",
        icon: ClipboardCheck,
        status: "planned",
      },
    ],
  },
  {
    key: "operations",
    items: [
      { key: "fees", href: "/fees", module: "fees", icon: Wallet, status: "planned" },
      {
        key: "communication",
        href: "/communication",
        module: "communication",
        icon: MessageSquare,
        status: "planned",
      },
      { key: "website", href: "/website", module: "website", icon: Globe, status: "planned" },
    ],
  },
];

/**
 * The same entries without their grouping, for consumers that only need to resolve a path
 * to a module (the breadcrumb) rather than render the menu.
 */
export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);
