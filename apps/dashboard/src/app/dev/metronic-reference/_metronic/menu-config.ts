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
 * Metronic's own `config/types.ts` MenuItem/MenuConfig shape, reproduced here rather than
 * imported (nothing in this repo vendors Metronic's config layer). Kept deliberately
 * identical in shape to what `sidebar-menu.tsx` expects, so that file itself can stay a
 * byte-accurate copy of Metronic's own `sidebar-menu.tsx`.
 */
export interface MenuItem {
  title?: string;
  icon?: LucideIcon;
  path?: string;
  heading?: string;
  children?: MenuConfig;
  disabled?: boolean;
}

export type MenuConfig = MenuItem[];

/**
 * schoolhub's own NAV_GROUPS (apps/dashboard/src/lib/nav-items.ts), reshaped into
 * Metronic's flat heading+item array — so this reference renders OUR real navigation
 * through Metronic's OWN rendering code, making it a fair visual comparison rather than
 * Metronic's own unrelated demo content.
 */
export const MENU_SIDEBAR: MenuConfig = [
  { heading: "Overview" },
  { title: "Dashboard", icon: LayoutDashboard, path: "/dev/metronic-reference" },
  { heading: "People" },
  { title: "Students", icon: GraduationCap, path: "/students" },
  { title: "Staff", icon: Users, path: "/staff" },
  { title: "Admissions", icon: UserRoundPlus, disabled: true },
  { heading: "Teaching" },
  { title: "Academics", icon: BookOpen, path: "/academics" },
  { title: "Timetable", icon: CalendarClock, path: "/timetable" },
  { title: "Attendance", icon: ClipboardCheck, disabled: true },
  { heading: "Operations" },
  { title: "Fees & Finance", icon: Wallet, disabled: true },
  { title: "Communication", icon: MessageSquare, disabled: true },
  { title: "Website", icon: Globe, disabled: true },
];
