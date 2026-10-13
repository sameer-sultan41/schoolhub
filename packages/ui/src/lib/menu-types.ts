import type { LucideIcon } from "lucide-react";

/** A generic tree-menu item shape — an app supplies its own data against this contract. */
export interface MenuItem {
  title?: string;
  icon?: LucideIcon;
  path?: string;
  rootPath?: string;
  childrenIndex?: number;
  heading?: string;
  children?: MenuConfig;
  disabled?: boolean;
  collapse?: boolean;
  collapseTitle?: string;
  expandTitle?: string;
  badge?: string;
  separator?: boolean;
  /** A permission-gated module key (e.g. "staff") — an app filters on this; this package never does. */
  module?: string;
  /** A permission key gating this item (e.g. "academics.curriculum.view") — an app filters on
   * this; this package never does. */
  permission?: string;
}

export type MenuConfig = MenuItem[];
