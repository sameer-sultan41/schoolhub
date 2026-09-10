"use client";

import { AccordionMenu, AccordionMenuGroup } from "@schoolhub/ui";

import { SearchSettingsItems } from "@/app/(app)/_metronic/partials/topbar/search/search-settings-items";
import type { SearchSettingsGroup } from "@/app/(app)/_metronic/partials/topbar/search/types";

// Ported verbatim from packages/ui's partials/dialogs/search/search-settings.tsx.
export function SearchSettings({ items }: { items: SearchSettingsGroup[] }) {
  return (
    <AccordionMenu type="single" collapsible classNames={{ separator: "-mx-2 mb-2.5" }}>
      <AccordionMenuGroup>
        {items.map((group, groupIndex) => (
          <div key={groupIndex} className="pb-2.5">
            <div className="ps-3 pt-2.5 text-xs font-medium text-secondary-foreground">
              <span className="ps-2">{group.title}</span>
              <div className="pe-3 pt-2">
                <SearchSettingsItems items={group.children} />
              </div>
            </div>
          </div>
        ))}
      </AccordionMenuGroup>
    </AccordionMenu>
  );
}
