"use client";

import { type ReactNode } from "react";
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
import { useTheme } from "next-themes";

import {
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

import { I18N_LANGUAGES, useLanguage, type Language } from "@/app/(app)/_metronic/i18n-config";

// Ported from packages/ui's partials/topbar/user-dropdown-menu.tsx. The vendor
// version reads a real next-auth session; this preview has no auth system, so
// the user identity is Metronic's own sample profile instead (its usual demo
// name/email), and "Logout" is a no-op — same substitution technique used
// elsewhere in this preview for pieces that need a real backend.
const SAMPLE_USER = { name: "Jenny Klabber", email: "jenny@keenthemes.com" };

export function UserDropdownMenu({ trigger }: { trigger: ReactNode }) {
  const { language, setLanguage } = useLanguage();
  const { theme, setTheme } = useTheme();

  const handleLanguage = (lang: Language) => {
    setLanguage(lang);
  };
  const handleThemeToggle = (checked: boolean) => {
    setTheme(checked ? "dark" : "light");
  };

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent className="w-64" side="bottom" align="end">
        <div className="flex items-center justify-between p-3">
          <div className="flex items-center gap-2">
            <img
              className="h-9 w-9 rounded-full border border-border"
              src="/media/avatars/300-2.png"
              alt="User avatar"
            />
            <div className="flex flex-col">
              <Link
                href="/account/home/get-started"
                className="text-mono text-sm font-semibold hover:text-primary"
              >
                {SAMPLE_USER.name}
              </Link>
              <Link
                href={`mailto:${SAMPLE_USER.email}`}
                className="text-xs text-muted-foreground hover:text-primary"
              >
                {SAMPLE_USER.email}
              </Link>
            </div>
          </div>
          <Badge variant="primary" appearance="light" size="sm">
            Pro
          </Badge>
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
              Language
              <Badge variant="outline" className="absolute end-0 top-1/2 -translate-y-1/2">
                {language.name}
                <img src={language.flag} className="h-3.5 w-3.5 rounded-full" alt={language.name} />
              </Badge>
            </span>
          </DropdownMenuSubTrigger>
          <DropdownMenuSubContent className="w-48">
            <DropdownMenuRadioGroup
              value={language.code}
              onValueChange={(value) => {
                const selectedLang = I18N_LANGUAGES.find((lang) => lang.code === value);
                if (selectedLang) handleLanguage(selectedLang);
              }}
            >
              {I18N_LANGUAGES.map((item) => (
                <DropdownMenuRadioItem
                  key={item.code}
                  value={item.code}
                  className="flex items-center gap-2"
                >
                  <img src={item.flag} className="h-4 w-4 rounded-full" alt={item.name} />
                  <span>{item.name}</span>
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
          <Button variant="outline" size="sm" className="w-full">
            Logout
          </Button>
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
