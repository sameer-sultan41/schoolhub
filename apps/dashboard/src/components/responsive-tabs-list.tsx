"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  Tabs,
  TabsList,
  TabsTrigger,
} from "@schoolhub/ui";

export interface ResponsiveTabItem {
  value: string;
  label: string;
}

export interface ResponsiveTabsListProps {
  items: ResponsiveTabItem[];
  value: string;
  onValueChange: (value: string) => void;
  /** "More" — the overflow trigger's label when the active tab isn't itself hidden. */
  moreLabel: string;
  className?: string;
}

/**
 * A `TabsList` that keeps every tab's full label and never scrolls: it measures its own
 * width and moves whichever trailing tabs don't fit into a "More" dropdown instead.
 *
 * Two UX failure modes this replaces: `overflow-x-auto` with no visible scrollbar looks
 * identical to a row that's simply cut off (nothing tells a user there's more to the
 * right), and shortening labels to force a fit changes what they say rather than how
 * they're laid out. Every tab stays reachable, with its real label, regardless of how
 * narrow the container is — down to a single tab plus "More" if it has to.
 *
 * Measurement works by rendering a second, real `Tabs`/`TabsList`/`TabsTrigger` tree —
 * same markup, same classes, so its widths are the real rendered widths, not an
 * estimate — positioned off-screen (`invisible absolute`, inert, `tabIndex={-1}`) purely
 * so a `ResizeObserver` on the visible container can read each trigger's `offsetWidth`
 * and decide how many fit before the next resize.
 */
export function ResponsiveTabsList({
  items,
  value,
  onValueChange,
  moreLabel,
  className,
}: ResponsiveTabsListProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const visibleListRef = useRef<HTMLDivElement>(null);
  const measureRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const moreMeasureRef = useRef<HTMLButtonElement>(null);
  const [visibleCount, setVisibleCount] = useState(items.length);

  useLayoutEffect(() => {
    const container = containerRef.current;
    const list = visibleListRef.current;
    if (!container || !list) return;

    const recalculate = () => {
      // The visible `TabsList` carries its own horizontal padding (`px-4`) — read it
      // from the real computed style rather than hardcoding the Tailwind value, so this
      // keeps working if that padding ever changes. Comparing raw `container.offsetWidth`
      // against the padding-less measurement row below consistently left the last tab a
      // padding's-width too wide, clipped by `overflow-hidden` instead of moved to "More".
      const listStyle = getComputedStyle(list);
      const horizontalPadding =
        Number.parseFloat(listStyle.paddingLeft) + Number.parseFloat(listStyle.paddingRight);
      // `gap-4`'s own 16px between flex children — missing this undercounts by a gap's
      // width per extra visible tab, which is what let a trailing tab render wide enough
      // to clip against `overflow-hidden` instead of ever being counted as overflow.
      const gap = Number.parseFloat(listStyle.columnGap || listStyle.gap || "0") || 0;
      const containerWidth = container.offsetWidth - horizontalPadding;
      const moreWidth = moreMeasureRef.current?.offsetWidth ?? 0;
      let used = 0;
      let count = 0;
      for (const item of items) {
        const width = measureRefs.current[item.value]?.offsetWidth ?? 0;
        const gapBefore = count > 0 ? gap : 0;
        const isLast = count === items.length - 1;
        // A visible "More" trigger costs its own width plus the gap that would precede
        // it, except when every item fits and there's no "More" trigger to make room for.
        const reserveForMore = isLast ? 0 : moreWidth + gap;
        const budget = containerWidth - reserveForMore;
        if (used + gapBefore + width > budget) break;
        used += gapBefore + width;
        count += 1;
      }
      setVisibleCount(Math.max(count, 1));
    };

    recalculate();
    const observer = new ResizeObserver(recalculate);
    observer.observe(container);
    return () => {
      observer.disconnect();
    };
  }, [items]);

  const visible = items.slice(0, visibleCount);
  const overflow = items.slice(visibleCount);
  const activeOverflowItem = overflow.find((item) => item.value === value);

  return (
    <div ref={containerRef} className={className}>
      <div
        aria-hidden="true"
        className="pointer-events-none invisible absolute start-0 top-0 flex w-full gap-4 px-4"
      >
        <Tabs value={value}>
          <TabsList variant="line" className="gap-4 border-b-0">
            {items.map((item) => (
              <TabsTrigger
                key={item.value}
                value={item.value}
                tabIndex={-1}
                ref={(el: HTMLButtonElement | null) => {
                  measureRefs.current[item.value] = el;
                }}
              >
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
        </Tabs>
        <Button ref={moreMeasureRef} variant="ghost" size="sm" tabIndex={-1} className="gap-1">
          {moreLabel}
          <ChevronDown className="size-4" aria-hidden="true" />
        </Button>
      </div>

      <TabsList
        ref={visibleListRef}
        variant="line"
        className="gap-4 overflow-hidden border-b-0 px-4"
      >
        {visible.map((item) => (
          <TabsTrigger key={item.value} value={item.value}>
            {item.label}
          </TabsTrigger>
        ))}
        {overflow.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="shrink-0 gap-1"
                data-state={activeOverflowItem ? "active" : undefined}
              >
                {activeOverflowItem ? activeOverflowItem.label : moreLabel}
                <ChevronDown className="size-4" aria-hidden="true" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {overflow.map((item) => (
                <DropdownMenuItem
                  key={item.value}
                  onSelect={() => {
                    onValueChange(item.value);
                  }}
                >
                  {item.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </TabsList>
    </div>
  );
}
