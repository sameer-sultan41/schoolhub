"use client";

import Link from "next/link";
import {
  BetweenHorizontalStart,
  Coffee,
  CreditCard,
  FileText,
  Globe,
  Moon,
  Settings,
  Shield,
  User,
  UserCircle,
  Users,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useTheme } from "next-themes";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";

import {
  Avatar,
  AvatarFallback,
  AvatarImage,
  Badge,
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
  Switch,
} from "@schoolhub/ui";

import { logout } from "@/lib/auth";
import { LOCALE_COOKIE_MAX_AGE_SECONDS, LOCALE_COOKIE_NAME, LOGIN_PATH } from "@/lib/constants";
import { SUPPORTED_LOCALES, type SupportedLocale } from "@/lib/env";
import { Services } from "@/services";

/**
 * Ported from packages/ui's partials/topbar/user-dropdown-menu.tsx. The vendor
 * version reads a real next-auth session; this now reads the real signed-in user via
 * `Services.auth.fetchCurrentUser()` (the same query `EntryCallout` uses — one cache
 * entry, one request). The trigger avatar moved in here from `header.tsx` so both it
 * and the panel's own avatar/name/email come from one fetch instead of two.
 *
 * No seeded account has an uploaded photo (`avatar_url` is null for all of them), so
 * every account showing the same stock Metronic photo read as "still not dynamic" even
 * though the name/email underneath it were real — `AvatarFallback` (Radix: renders
 * automatically whenever `AvatarImage` has no `src` or fails to load) shows the
 * person's own initials instead, which actually varies per account. `email` is
 * nullable (phone-only accounts exist) — falls back to phone, then to nothing shown.
 * The vendor's "Pro" billing badge is replaced with the user's real role.
 */
function initialsOf(name: string): string {
  const [first, ...rest] = name.trim().split(/\s+/).filter(Boolean);
  if (!first) return "?";
  const last = rest.at(-1);
  return last ? `${first[0]}${last[0]}`.toUpperCase() : first.slice(0, 2).toUpperCase();
}

/** Metronic's own demo covered 5 unrelated languages with flags; this app ships 2. */
const LOCALE_FLAGS: Record<SupportedLocale, string> = {
  en: "/media/flags/united-states.svg",
  ur: "/media/flags/pakistan.svg",
};

export function UserDropdownMenu() {
  const t = useTranslations("nav");
  const locale = useLocale();
  const { theme, setTheme } = useTheme();
  const router = useRouter();
  const {
    data: user,
    isPending,
    isError,
  } = useQuery({
    queryKey: ["dashboard", "current-user"],
    queryFn: () => Services.auth.fetchCurrentUser(),
  });

  // Distinct from "still loading": an error (e.g. the API unreachable) must not sit on
  // the loading label forever, which reads as a hang rather than a real failure.
  const displayName = isPending ? "Loading…" : isError ? "Unable to load profile" : user.full_name;
  const contact = user?.email ?? user?.phone ?? null;
  const initials = user ? initialsOf(user.full_name) : "?";
  const roleLabel = user?.roles.length ? user.roles.map((role) => role.name).join(", ") : null;

  // Mirrors the pre-deletion user-menu.tsx's selectLocale: the locale is resolved
  // server-side from this same cookie (src/i18n/request.ts), including <html
  // lang>/<dir>, so nothing changes until the server re-renders — hence router.refresh().
  function selectLocale(next: string) {
    if (next === locale) return;
    document.cookie = `${LOCALE_COOKIE_NAME}=${next}; path=/; max-age=${LOCALE_COOKIE_MAX_AGE_SECONDS}; samesite=lax`;
    router.refresh();
  }
  const handleThemeToggle = (checked: boolean) => {
    setTheme(checked ? "dark" : "light");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Avatar
          data-testid="user-menu-trigger"
          className="size-9 shrink-0 cursor-pointer rounded-full border-2 border-green-500"
        >
          {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt={displayName} /> : null}
          <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
        </Avatar>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" side="bottom" align="end">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <Avatar className="h-9 w-9">
              {user?.avatar_url ? <AvatarImage src={user.avatar_url} alt={displayName} /> : null}
              <AvatarFallback className="text-xs font-medium">{initials}</AvatarFallback>
            </Avatar>
            <div className="flex flex-col">
              <Link
                href="/account/home/get-started"
                className="text-mono text-sm font-semibold hover:text-primary"
              >
                {displayName}
              </Link>
              {contact ? (
                <Link
                  href={user?.email ? `mailto:${user.email}` : `tel:${contact}`}
                  className="text-xs text-muted-foreground hover:text-primary"
                >
                  {contact}
                </Link>
              ) : null}
            </div>
          </div>
          {roleLabel ? (
            <Badge variant="primary" appearance="light" size="sm">
              {roleLabel}
            </Badge>
          ) : null}
        </div>

        <DropdownMenuSeparator />

        <DropdownMenuItem asChild>
          <Link href="/public-profile/profiles/default" className="flex items-center gap-2">
            <UserCircle />
            Public Profile
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href="/account/home/user-profile" className="flex items-center gap-2">
            <User />
            My Profile
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2">
            <Settings />
            My Account
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuItem asChild>
              <Link href="/account/home/get-started" className="flex items-center gap-2">
                <Coffee />
                Get Started
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/home/user-profile" className="flex items-center gap-2">
                <FileText />
                My Profile
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/billing/basic" className="flex items-center gap-2">
                <CreditCard />
                Billing
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/security/overview" className="flex items-center gap-2">
                <Shield />
                Security
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/members/teams" className="flex items-center gap-2">
                <Users />
                Members & Roles
              </Link>
            </DropdownMenuItem>
            <DropdownMenuItem asChild>
              <Link href="/account/integrations" className="flex items-center gap-2">
                <BetweenHorizontalStart />
                Integrations
              </Link>
            </DropdownMenuItem>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuItem asChild>
          <Link href="https://devs.keenthemes.com" className="flex items-center gap-2">
            <FileText />
            Dev Forum
          </Link>
        </DropdownMenuItem>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger className="flex items-center gap-2 hover:[&_[data-slot=badge]]:border-input data-[state=open]:[&_[data-slot=badge]]:border-input [&_[data-slot=dropdown-menu-sub-trigger-indicator]]:hidden">
            <Globe />
            <span className="relative flex grow items-center justify-between gap-2">
              {t("locale.label")}
              <Badge variant="outline" className="absolute end-0 top-1/2 -translate-y-1/2">
                {t(`locale.${locale}`)}
                <img
                  src={LOCALE_FLAGS[locale as SupportedLocale]}
                  className="h-3.5 w-3.5 rounded-full"
                  alt={t(`locale.${locale}`)}
                />
              </Badge>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuRadioGroup value={locale} onValueChange={selectLocale}>
              {SUPPORTED_LOCALES.map((code) => (
                <DropdownMenuRadioItem key={code} value={code} className="flex items-center gap-2">
                  <img
                    src={LOCALE_FLAGS[code]}
                    className="h-4 w-4 rounded-full"
                    alt={t(`locale.${code}`)}
                  />
                  <span>{t(`locale.${code}`)}</span>
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuSubContent>
        </DropdownMenuSub>

        <DropdownMenuSeparator />

        <DropdownMenuItem
          className="flex items-center gap-2"
          onSelect={(event) => {
            event.preventDefault();
          }}
        >
          <Moon />
          <div className="flex grow items-center justify-between gap-2">
            Dark Mode
            <Switch size="sm" checked={theme === "dark"} onCheckedChange={handleThemeToggle} />
          </div>
        </DropdownMenuItem>
        <div className="mt-1 p-2">
          <Button
            variant="outline"
            size="sm"
            className="w-full"
            onClick={() => {
              // logout() intentionally rethrows anything that isn't the expected
              // ApiError (see its own comment in lib/auth.ts), so that rejection must
              // be handled here rather than left as an unhandled promise rejection.
              // The user still always reaches /login: the unexpected case is logged,
              // not swallowed or re-thrown.
              void logout()
                .catch((error: unknown) => {
                  console.error("Sign-out request failed unexpectedly:", error);
                })
                .finally(() => {
                  router.replace(LOGIN_PATH);
                });
            }}
          >
            Logout
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
