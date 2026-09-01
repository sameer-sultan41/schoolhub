import { Fraunces, Inter, Noto_Nastaliq_Urdu } from "next/font/google";
import { checkBrandingContrast } from "@schoolhub/ui/lib/branding";
import type { ReactNode } from "react";
import { resolveTenant } from "@/lib/tenant";
import { themeStyle } from "@/themes/default";
import "./globals.css";

/**
 * Same fonts, same rationale as apps/dashboard/src/app/layout.tsx: SIL OFL via Google
 * Fonts (next/font self-hosts the files it downloads at build time — nothing is vendored
 * into this repo, so there is no redistribution question), variable so `weight` is
 * omitted, and only ever wired in as the FALLBACK inside `--sh-font-body`/`-heading` —
 * `themeStyle` below still lets a tenant's own `body_font`/`heading_font` win outright.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
// preload: false — see apps/dashboard/src/app/layout.tsx for why: next/font defaults to
// preloading whenever `subsets` is given, and this heavy face is only ever reached by a
// per-character fallback for Urdu glyphs, not rendered on most tenant pages.
const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  subsets: ["arabic"],
  variable: "--font-noto-nastaliq-urdu",
  display: "swap",
  preload: false,
});

/**
 * Root layout. The tenant's branding is applied here as CSS custom properties, so every
 * section below renders in the school's colours with no per-tenant code.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const resolution = await resolveTenant();
  const tenant = resolution.status === "unknown" ? null : resolution.tenant;
  const locale = tenant?.locale.default_locale ?? "en";
  const dir = tenant?.locale.direction ?? "ltr";

  // Server-side, not a client useEffect like apps/dashboard's TenantTheme: this is the only
  // surface where a tenant's branding reaches the public, parent-facing site, so it's the
  // one that most needs the same warning apps/dashboard's admin-only view already gets.
  for (const warning of checkBrandingContrast(tenant?.branding)) {
    console.warn(
      `Tenant branding fails WCAG AA contrast for ${warning.pair} (${warning.ratio.toFixed(2)}:1, needs 4.5:1).`,
    );
  }

  return (
    <html
      lang={locale}
      dir={dir}
      className={`${inter.variable} ${fraunces.variable} ${notoNastaliqUrdu.variable}`}
      style={themeStyle(tenant?.branding)}
    >
      <body className="min-h-full">{children}</body>
    </html>
  );
}
