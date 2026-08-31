import { Fraunces, Inter, Noto_Nastaliq_Urdu } from "next/font/google";
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
const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  subsets: ["arabic"],
  variable: "--font-noto-nastaliq-urdu",
  display: "swap",
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
