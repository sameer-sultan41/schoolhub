"use client";

import type { ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@schoolhub/ui";

import { useUrlParams } from "@/hooks/use-url-params";
import { LIST_URL_KEYS } from "@/lib/constants";
import { FEES_TAB_URL_KEY } from "@/services/modules/fee-structures/fee-structures-constant";

export interface FeesTabSpec {
  id: string;
  label: string;
  content: ReactNode;
}

export interface FeesTabsProps {
  tabs: readonly FeesTabSpec[];
  /** The tab list's accessible name. */
  label: string;
  /** The URL keys each tab's list owns (its filters): a tab change clears them, as the next
   * tab reads the same query string under other meanings. */
  scopedKeys: readonly string[];
}

/**
 * A page's sub-tabs, in `?tab=`. The first tab is the URL's default, so it leaves the key out;
 * an unknown `tab` shows the first. Only the active tab's content is mounted, and a change
 * clears the list state every tab shares (search, sort, hidden columns) and the tabs' filters.
 */
export function FeesTabs({ tabs, label, scopedKeys }: FeesTabsProps) {
  const { searchParams, setParams } = useUrlParams();
  const first = tabs[0];
  if (!first) return null;

  const requested = searchParams.get(FEES_TAB_URL_KEY);
  const active = tabs.find((tab) => tab.id === requested) ?? first;

  return (
    <Tabs
      value={active.id}
      onValueChange={(value) => {
        setParams({
          [FEES_TAB_URL_KEY]: value === first.id ? null : value,
          ...Object.fromEntries(
            [...Object.values(LIST_URL_KEYS), ...scopedKeys].map((key) => [key, null]),
          ),
        });
      }}
      className="space-y-4"
    >
      <TabsList variant="line" aria-label={label}>
        {tabs.map((tab) => (
          <TabsTrigger key={tab.id} value={tab.id}>
            {tab.label}
          </TabsTrigger>
        ))}
      </TabsList>
      {tabs.map((tab) => (
        <TabsContent key={tab.id} value={tab.id}>
          {tab.id === active.id && tab.content}
        </TabsContent>
      ))}
    </Tabs>
  );
}
