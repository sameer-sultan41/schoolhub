import type { PermissionKey } from "@schoolhub/types";

/**
 * Navigation mirrors the module docs one-to-one. Each entry names the module it belongs to,
 * so the menu is filtered by the user's effective permissions — a teacher never sees the
 * payroll link. Server-side RBAC still enforces every one of these.
 */
export const NAV_ITEMS: {
  key: string;
  href: string;
  module: string;
  permission?: PermissionKey;
}[] = [
  { key: "dashboard", href: "/dashboard", module: "" },
  { key: "students", href: "/students", module: "students" },
  { key: "staff", href: "/staff", module: "staff" },
  { key: "attendance", href: "/attendance", module: "attendance" },
  { key: "academics", href: "/academics", module: "academics" },
  { key: "fees", href: "/fees", module: "fees" },
  { key: "admissions", href: "/admissions", module: "admissions" },
  { key: "communication", href: "/communication", module: "communication" },
  { key: "website", href: "/website", module: "website" },
];
