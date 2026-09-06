"use client";

import type { AuthenticatedUser } from "@schoolhub/types";
import {
  Avatar,
  AvatarFallback,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@schoolhub/ui";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { logout } from "@/lib/auth";
import { LOGIN_PATH } from "@/lib/constants";
import { SUPPORTED_LOCALES } from "@/lib/env";

/**
 * Mirrors `LOCALE_COOKIE_NAME` in `src/i18n/request.ts`, which cannot be imported here:
 * that module pulls in `next/headers` and is server-only, so importing it from a client
 * component is a build error rather than a bundle-size question. Written from JS on
 * whichever host the browser is already on, for the same reason `lib/auth.ts` sets the
 * session cookie that way rather than having the API do it.
 */
const LOCALE_COOKIE_NAME = "sh_locale";

/** A year: a language choice is not a session, and should survive one. */
const LOCALE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365;

/**
 * "Ayesha Khan" → "AK". First and last only: a middle initial in a 32px circle is noise,
 * and a single-word name still gets one letter rather than an empty disc.
 */
function initialsFor(fullName: string): string {
  const parts = fullName.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] : undefined;
  // charAt rather than [0]: it returns "" past the end instead of undefined, so an empty
  // name produces an empty disc rather than a broken one.
  return `${first.charAt(0)}${last?.charAt(0) ?? ""}`.toUpperCase();
}

/**
 * Identity, language and sign-out, collapsed into the one control people already look for
 * in a top-right corner. Replaces the bare name plus a permanently visible "Sign out"
 * button: the name was not a control, and the destructive action was the most prominent
 * thing in the header.
 *
 * Takes the user as a prop rather than calling `useSession()` itself — the shell has
 * already resolved it, and a second subscription here would re-render this menu on every
 * session refetch for no gain.
 */
export function UserMenu({ user }: { user: AuthenticatedUser | null }) {
  const t = useTranslations("nav");
  const locale = useLocale();
  const router = useRouter();

  const fullName = user?.full_name ?? "";
  const roleSlug = user?.roles[0]?.slug ?? "";

  function selectLocale(next: string) {
    // Radix fires onValueChange even for the already-checked item; re-writing the same
    // cookie and forcing a server round-trip for it is pure churn.
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE_NAME}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
    // The locale is resolved server-side from that cookie (src/i18n/request.ts), including
    // <html lang>/<dir>, so nothing changes until the server renders this route again.
    router.refresh();
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {/* aria-label, not the initials: "AK" is a decoration a screen reader cannot make
            sense of, and the same two letters name two different people in two tenants. */}
        <Button variant="ghost" size="icon" className="rounded-full" aria-label={t("account")}>
          <Avatar className="size-8">
            <AvatarFallback>{initialsFor(fullName)}</AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>

      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuLabel>
          <span className="block truncate text-foreground">{fullName}</span>
          {roleSlug ? <span className="block truncate text-xs font-normal">{roleSlug}</span> : null}
        </DropdownMenuLabel>

        <DropdownMenuSeparator />

        <DropdownMenuLabel className="text-xs font-normal">{t("locale.label")}</DropdownMenuLabel>
        <DropdownMenuRadioGroup value={locale} onValueChange={selectLocale}>
          {SUPPORTED_LOCALES.map((option) => (
            <DropdownMenuRadioItem key={option} value={option}>
              {t(`locale.${option}`)}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          onSelect={() => {
            // onSelect expects void, but logout() is async — and it intentionally rethrows
            // anything that isn't the expected ApiError (see its own comment), so that
            // rejection must be handled here rather than left to become an unhandled
            // promise rejection. The user still always reaches /login: the unexpected case
            // is logged, not swallowed or re-thrown.
            void logout()
              .catch((error: unknown) => {
                console.error("Sign-out request failed unexpectedly:", error);
              })
              .finally(() => {
                router.replace(LOGIN_PATH);
              });
          }}
        >
          {t("signOut")}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
