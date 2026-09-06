import type { Metadata } from "next";
import type { CSSProperties } from "react";

export const metadata: Metadata = {
  title: "SchoolHub",
  robots: { index: false, follow: false },
};

/**
 * This page belongs to nobody's tenant, so it must render SchoolHub's own brand rather
 * than the tenant-overridable defaults — the same reasoning, and the same mechanism, as
 * apps/dashboard's `(auth)/layout.tsx`.
 *
 * It previously carried no brand at all and looked right only by coincidence:
 * `themeStyle(null)` returns `{}`, so the page fell through to the `:root` defaults,
 * which happened to equal the platform brand. That coincidence ended when the platform
 * palette moved and the defaults moved with it — a tenant-facing default is free to
 * change, and this page must not follow it.
 */
const PLATFORM_BRAND_STYLE: CSSProperties = {
  "--sh-color-primary": "var(--sh-platform-color-primary)",
  "--sh-color-primary-foreground": "var(--sh-platform-color-primary-foreground)",
  "--sh-color-accent": "var(--sh-platform-color-accent)",
  "--sh-color-accent-foreground": "var(--sh-platform-color-accent-foreground)",
  "--sh-color-surface": "var(--sh-platform-color-surface)",
} as CSSProperties;

/**
 * Shown when the Host header matches no tenant (the platform apex, a reserved subdomain,
 * or an unverified domain). Deliberately generic: an unknown host must never fall through
 * to a tenant's content.
 */
export default function PlatformLandingPage() {
  return (
    <main style={PLATFORM_BRAND_STYLE} className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-heading text-2xl font-semibold text-primary">SchoolHub</h1>
      <p className="mt-3 text-foreground/75">No school website is configured for this address.</p>
    </main>
  );
}
