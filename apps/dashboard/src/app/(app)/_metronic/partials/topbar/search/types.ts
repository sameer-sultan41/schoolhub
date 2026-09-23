import type { LucideIcon } from "lucide-react";

import type { Avatars } from "@/app/(app)/_metronic/partials/common/avatar-group";

// Ported verbatim from packages/ui's partials/dialogs/search/types.ts.
export interface SearchDocsItem {
  image: string;
  desc: string;
  date: string;
}

export interface SearchSettingsItem {
  icon: LucideIcon;
  info: string;
}

export interface SearchSettingsGroup {
  title: string;
  children: SearchSettingsItem[];
}

export interface SearchIntegrationsItem {
  logo: string;
  name: string;
  description: string;
  team: Avatars;
}

export interface SearchUsersItem {
  avatar: string;
  name: string;
  email: string;
  label: string;
  color:
    "success" | "destructive" | "primary" | "secondary" | "warning" | "info" | null | undefined;
}
