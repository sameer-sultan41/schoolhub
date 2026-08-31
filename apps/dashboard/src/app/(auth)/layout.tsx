import { getTranslations } from "next-intl/server";
import type { CSSProperties, ReactNode } from "react";

/**
 * /login (and every other route under this group) is never a tenant's — it's shown
 * before a user, and therefore any tenant, is known. It renders SchoolHub's own
 * "Marigold & Indigo" platform brand rather than the tenant-overridable default, by
 * overriding the same --sh-color-* variables every component already reads (bg-primary,
 * bg-surface, ...) with the never-tenant-overridable --sh-platform-* values from
 * theme.css — the identical mechanism TenantTheme uses to re-theme for a real tenant,
 * just scoped to this subtree instead of a fetched branding object. Every component
 * (Card, Button, Form, ...) needs zero changes to render correctly here: it only ever
 * reads --sh-color-primary etc, never knows or cares which tier supplied the value.
 */
const PLATFORM_BRAND_STYLE: CSSProperties = {
  "--sh-color-primary": "var(--sh-platform-color-primary)",
  "--sh-color-primary-foreground": "var(--sh-platform-color-primary-foreground)",
  "--sh-color-surface": "var(--sh-platform-color-surface)",
  "--sh-color-surface-foreground": "var(--sh-platform-color-primary)",
} as CSSProperties;

/** Centered, platform-branded shell for the unauthenticated routes. */
export default async function AuthLayout({ children }: { children: ReactNode }) {
  const t = await getTranslations("app");

  return (
    <main
      style={PLATFORM_BRAND_STYLE}
      className="flex min-h-dvh flex-col items-center justify-center bg-primary px-4 py-12"
    >
      <div className="w-full max-w-sm space-y-6">
        <div className="space-y-1 text-center">
          <p className="font-heading text-xl font-semibold text-primary-foreground">{t("name")}</p>
          <p className="text-sm text-primary-foreground/70">{t("tagline")}</p>
        </div>
        {children}
      </div>
    </main>
  );
}
