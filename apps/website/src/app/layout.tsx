import { Fraunces, Inter, Noto_Nastaliq_Urdu } from "next/font/google";
import { permanentRedirect } from "next/navigation";
import type { ReactNode } from "react";
import { customDomainRedirectTarget, resolveTenant } from "@/lib/tenant";
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
 *
 * A platform-subdomain request for a school with a primary custom domain is permanently
 * redirected there (website-builder.md §4). It happens here, after the cached
 * `resolveTenant()`, because the proxy stays I/O-free and cannot know the domain.
 */
export default async function RootLayout({ children }: { children: ReactNode }) {
  const resolution = await resolveTenant();
  const redirectTarget = await customDomainRedirectTarget(resolution);
  if (redirectTarget) permanentRedirect(redirectTarget);
  const tenant = resolution.status === "unknown" ? null : resolution.tenant;
  const locale = tenant?.locale.default_locale ?? "en";
  const dir = tenant?.locale.direction ?? "ltr";

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
