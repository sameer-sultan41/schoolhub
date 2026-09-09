"use client";

import { AccordionMenuItem } from "@schoolhub/ui";

import type { SearchSettingsItem } from "./types";

// Ported verbatim from packages/ui's partials/dialogs/search/search-settings-items.tsx.
export function SearchSettingsItems({ items }: { items: SearchSettingsItem[] }) {
  return (
    <>
      {items.map((item, index) => (
        <AccordionMenuItem key={index} value={item.info}>
          <item.icon size={16} />
          <span>{item.info}</span>
        </AccordionMenuItem>
      ))}
    </>
  );
}
