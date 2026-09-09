"use client";

import { AccordionMenu, AccordionMenuGroup } from "@schoolhub/ui";

import { SearchIntegrations } from "./search-integrations";
import { SearchSettingsItems } from "./search-settings-items";
import { SearchUsers } from "./search-users";
import type { SearchIntegrationsItem, SearchSettingsItem, SearchUsersItem } from "./types";

// Ported verbatim from packages/ui's partials/dialogs/search/search-mixed.tsx.
export interface SearchMixedProps {
  settings: SearchSettingsItem[];
  integrations: SearchIntegrationsItem[];
  users: SearchUsersItem[];
}

export function SearchMixed({ settings, integrations, users }: SearchMixedProps) {
  return (
    <div className="flex flex-col gap-2.5">
      <div className="ps-3 pt-2.5 pb-1.5 text-xs font-medium text-secondary-foreground">
        <span className="ps-2">Settings</span>
        <div className="pt-2">
          <AccordionMenu type="single" collapsible classNames={{ separator: "-mx-2 mb-2.5" }}>
            <AccordionMenuGroup>
              <SearchSettingsItems items={settings} />
            </AccordionMenuGroup>
          </AccordionMenu>
        </div>
      </div>
      <div className="border-b border-b-border"></div>
      <div className="pt-2.5 pb-1.5 text-xs font-medium text-secondary-foreground">
        <span className="ps-4">Integrations</span>
        <div className="pt-2">
          <SearchIntegrations items={integrations} />
        </div>
      </div>
      <div className="border-b border-b-border"></div>
      <div className="pt-2.5 pb-1.5 text-xs font-medium text-secondary-foreground">
        <span className="ps-4">Users</span>
        <div className="pt-2">
          <SearchUsers items={users} />
        </div>
      </div>
    </div>
  );
}
