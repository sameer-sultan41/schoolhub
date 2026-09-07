import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Fraunces, Inter, JetBrains_Mono, Noto_Nastaliq_Urdu } from "next/font/google";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers";
import { PLATFORM_NAME } from "@/lib/constants";
import { directionFor } from "@/lib/env";
import { preferenceDataAttributes } from "@/lib/preferences/preferences-config";
import { readPreferencesFromCookies } from "@/lib/preferences/preferences-cookies.server";
import { PreferencesProvider } from "@/lib/preferences/preferences-provider";
import "./globals.css";

/**
 * Self-hosted (next/font downloads and serves these at build time — no runtime request to
 * Google) but licensed, not vendored: all three are SIL Open Font License via Google Fonts,
 * so no font BINARY is committed to this repo and no redistribution question exists. Each
 * only produces a CSS variable here; `packages/ui/src/styles/theme.css` is what actually
 * puts them into `--sh-font-body`/`--sh-font-heading`, in the FALLBACK position — a
 * tenant's own `body_font`/`heading_font` (branding.ts) still overrides the whole variable,
 * unaffected by whichever face loads here.
 *
 * All three are variable fonts (no static weight list to pick from), so `weight` is
 * intentionally omitted — see next/font's own docs on this.
 */
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({ subsets: ["latin"], variable: "--font-fraunces", display: "swap" });
// Nastaliq is what makes Urdu body/heading text render correctly at all — the platform
// default before this had NO Urdu-capable face in its font stack. preload: false because
// next/font defaults to preloading whenever `subsets` is given: this heavy face sits
// behind Inter/Fraunces in --sh-font-body and is only ever actually used by a per-
// character fallback for Urdu glyphs, so preloading it would fetch it on the critical
// path of every all-Latin page too. It's still resolved and served the moment Urdu text
// appears, exactly as before — only the eager fetch on unrelated pages is removed.
// The face every figure wears (--sh-font-numeric). Latin subset only: it is
// reached solely by digits and the odd currency symbol, and Urdu glyphs inside a
// formatted value fall through to Nastaliq per-character, exactly as they do in
// the body stack.
const jetBrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
});
const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  subsets: ["arabic"],
  variable: "--font-noto-nastaliq-urdu",
  display: "swap",
  preload: false,
});

export const metadata: Metadata = {
  title: {
    default: PLATFORM_NAME,
    template: `%s · ${PLATFORM_NAME}`,
  },
  description: `${PLATFORM_NAME} administration dashboard`,
  // The dashboard is a private application: keep it out of every index.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();
  // Read here rather than in a client boot script: this layout is already dynamic (the
  // locale above comes from a cookie), so the attributes can be part of the server's own
  // markup and there is no first paint with the wrong layout to hide.
  const preferences = await readPreferencesFromCookies();

  return (
    // suppressHydrationWarning is required by next-themes, not a workaround for a bug of
    // ours: its inline script writes the theme class onto <html> BEFORE React hydrates
    // (that is what prevents a flash of the wrong theme), so the server markup and the
    // client's first read of this element differ by design. Scoped to <html> only, so a
    // genuine mismatch anywhere inside the app still surfaces.
    <html
      lang={locale}
      dir={directionFor(locale)}
      suppressHydrationWarning
      className={`h-full ${inter.variable} ${fraunces.variable} ${jetBrainsMono.variable} ${notoNastaliqUrdu.variable}`}
      // Layout preferences ride on <html> because that is the only element every CSS rule
      // below can reach — the preset stylesheets key off [data-theme-preset], and the
      // shell reads the rest through `[html[data-…]_&]` variants.
      {...preferenceDataAttributes(preferences)}
    >
      <body className="min-h-full font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <PreferencesProvider initialValues={preferences}>
            <AppProviders>{children}</AppProviders>
          </PreferencesProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
