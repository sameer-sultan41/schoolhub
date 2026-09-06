"use client";

import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@schoolhub/ui";
import { Monitor, Moon, Sun } from "lucide-react";
import { useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useSyncExternalStore } from "react";

/** Stable no-op subscription: the "have we hydrated yet" value never changes after mount. */
const subscribeToNothing = () => () => undefined;

/**
 * Light / dark / match-system, backed by next-themes (`attribute="class"` in
 * `providers.tsx`, matching the `dark` variant `packages/ui/src/styles/theme.css`
 * defines).
 *
 * "Match system" stays the default and is offered explicitly rather than implied by the
 * absence of a choice — before this component existed the OS preference was the ONLY
 * mechanism, and a viewer who wants to keep that behaviour should be able to say so and
 * see it selected.
 */
export function ThemeToggle() {
  const t = useTranslations("nav.theme");
  const { theme, setTheme, resolvedTheme } = useTheme();

  // `resolvedTheme` is undefined until next-themes' inline script has run and the tree
  // has hydrated, so branching the icon on it during the server render — or the first
  // client render — is the classic next-themes hydration mismatch.
  //
  // useSyncExternalStore rather than the usual useState+useEffect mount flag: React's own
  // hook lint rejects setState in an effect body, and this is what the API is for — the
  // server snapshot is `false`, the client snapshot is `true`, and React handles the
  // handover without a cascading render.
  //
  // Showing the system icon until then is honest rather than a placeholder: at that
  // instant the theme genuinely is whatever the system says.
  const hydrated = useSyncExternalStore(
    subscribeToNothing,
    () => true,
    () => false,
  );

  const Icon = !hydrated ? Monitor : resolvedTheme === "dark" ? Moon : Sun;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" aria-label={t("label")}>
          <Icon aria-hidden="true" className="size-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuRadioGroup value={theme ?? "system"} onValueChange={setTheme}>
          <DropdownMenuRadioItem value="light">{t("light")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="dark">{t("dark")}</DropdownMenuRadioItem>
          <DropdownMenuRadioItem value="system">{t("system")}</DropdownMenuRadioItem>
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
