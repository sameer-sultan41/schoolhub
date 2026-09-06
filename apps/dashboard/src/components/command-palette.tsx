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
import { useSession } from "@/hooks/use-session";
import { NAV_GROUPS } from "@/lib/nav-items";
import { canAccessModule, hasPermission } from "@/lib/permissions";
import { PALETTE_QUICK_ACTIONS } from "@/lib/quick-actions";

/**
 * ⌘K / Ctrl+K navigation and actions.
 *
 * Deliberately discoverable rather than hidden behind the shortcut: the header renders a
 * visible trigger showing the key, because a keyboard-only feature is a feature most
 * people never learn exists.
 *
 * `planned` modules never appear here. They are shown in the sidebar so a school owner
 * can see what the platform covers, but a search result that navigates to a 404 is a
 * different and worse thing than a labelled "Soon".
 */
export function CommandPalette() {
  const t = useTranslations("nav.command");
  const tNav = useTranslations("nav");
  const router = useRouter();
  const { user } = useSession();
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
    items: group.items.filter(
      (item) =>
        item.status === "ready" && (item.module === "" || canAccessModule(user, item.module)),
    ),
  })).filter((group) => group.items.length > 0);

  // Shared with the Quick actions panel — see lib/quick-actions.ts. Each entry names the
  // permission key the API really enforces, so the palette stays a shortcut to something
  // the person can already do rather than a way to reach something they cannot.
  const actions = PALETTE_QUICK_ACTIONS.filter((action) => hasPermission(user, action.permission));

  return (
    <>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          setOpen(true);
        }}
        className="hidden gap-2 text-muted-foreground sm:inline-flex"
        leadingIcon={<Search aria-hidden="true" className="size-4" />}
      >
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

          {actions.length > 0 ? (
            <>
              <CommandSeparator />
              <CommandGroup heading={t("actions")}>
                {actions.map((action) => (
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
