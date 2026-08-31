import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { Fraunces, Inter, Noto_Nastaliq_Urdu } from "next/font/google";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers";
import { directionFor } from "@/lib/env";
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
// default before this had NO Urdu-capable face in its font stack.
const notoNastaliqUrdu = Noto_Nastaliq_Urdu({
  subsets: ["arabic"],
  variable: "--font-noto-nastaliq-urdu",
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "SchoolHub",
    template: "%s · SchoolHub",
  },
  description: "SchoolHub administration dashboard",
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

  return (
    <html
      lang={locale}
      dir={directionFor(locale)}
      className={`h-full ${inter.variable} ${fraunces.variable} ${notoNastaliqUrdu.variable}`}
    >
      <body className="min-h-full font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
