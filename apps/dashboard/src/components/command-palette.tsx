"use client";

import { Button } from "@schoolhub/ui";
import { Search } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
  CommandShortcut,
} from "@/components/command";
import { NAV_GROUPS } from "@/lib/nav-items";
import { PALETTE_QUICK_ACTIONS } from "@/lib/quick-actions";

/**
 * ⌘K / Ctrl+K navigation and actions.
 *
 * Deliberately discoverable rather than hidden behind the shortcut: the header renders a
 * visible trigger showing the key, because a keyboard-only feature is a feature most
 * people never learn exists.
 *
 * `planned` modules never appear here — a search result that navigates to a 404 is a
 * different and worse thing than a labelled "Soon" in the sidebar.
 *
 * Not permission-filtered yet: AppShell has no session to filter by (see
 * docs/metronic-dashboard-shell.md's backlog), and `canAccessModule`/`hasPermission` both
 * return false for a null user — filtering against them here would show nothing at all.
 * Every ready module and every quick action renders unconditionally, same temporary stance
 * `dashboard-nav.tsx` already takes for the sidebar. Restore real filtering in both places
 * together, in the session/tenant chunk.
 */
export function CommandPalette() {
  const t = useTranslations("nav.command");
  const tNav = useTranslations("nav");
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      // metaKey AND ctrlKey: ⌘K on macOS, Ctrl+K everywhere else, one listener.
      if (event.key.toLowerCase() !== "k" || !(event.metaKey || event.ctrlKey)) return;
      event.preventDefault();
      setOpen((isOpen) => !isOpen);
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router],
  );

  const navGroups = NAV_GROUPS.map((group) => ({
    key: group.key,
    items: group.items.filter((item) => item.status === "ready"),
  })).filter((group) => group.items.length > 0);

  return (
    <>
      <Button
        variant="chrome-outline"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        className="hidden gap-2 sm:inline-flex"
      >
        <Search aria-hidden="true" className="size-4" />
        {t("trigger")}
        <CommandShortcut>{t("shortcut")}</CommandShortcut>
      </Button>

      <CommandDialog
        open={open}
        onOpenChange={setOpen}
        title={t("title")}
        description={t("description")}
        closeLabel={t("close")}
      >
        <CommandInput placeholder={t("placeholder")} />
        <CommandList>
          <CommandEmpty>{t("empty")}</CommandEmpty>

          {navGroups.map((group) => (
            <CommandGroup key={group.key} heading={tNav(`groups.${group.key}`)}>
              {group.items.map((item) => (
                <CommandItem
                  key={item.key}
                  value={tNav(item.key)}
                  onSelect={() => {
                    go(item.href);
                  }}
                >
                  <item.icon aria-hidden="true" />
                  {tNav(item.key)}
                </CommandItem>
              ))}
            </CommandGroup>
          ))}

          {PALETTE_QUICK_ACTIONS.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("actions")}>
                {PALETTE_QUICK_ACTIONS.map((action) => (
                  <CommandItem
                    key={action.key}
                    value={t(`action.${action.key}`)}
                    onSelect={() => {
                      go(action.href);
                    }}
                  >
                    <action.icon aria-hidden="true" />
                    {t(`action.${action.key}`)}
                  </CommandItem>
                ))}
              </CommandGroup>
            </>
          ) : null}
        </CommandList>
      </CommandDialog>
    </>
  );
}
