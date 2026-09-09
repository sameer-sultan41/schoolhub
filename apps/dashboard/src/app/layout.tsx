import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { ThemeProvider } from "next-themes";
import { AppProviders } from "@/components/providers";
import { directionFor } from "@/lib/env";

import "./globals.css";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    // data-theme-preset="metronic" activates @schoolhub/ui's metronic.css preset
    // (packages/ui/src/styles/presets/metronic.css) app-wide — every route, not just
    // (app)/_metronic's Shell, uses Metronic's actual color tokens now, so this can't be
    // toggled on mount by Shell alone: that left (auth)/login (and any route outside
    // Shell) rendering with @schoolhub/ui's own default palette instead.
    // dir flips the whole app to RTL for Urdu — every layout in this app uses logical
    // CSS properties (start/end, not left/right) specifically so this one switch works.
    <html
      lang={locale}
      dir={directionFor(locale)}
      suppressHydrationWarning
      data-theme-preset="metronic"
    >
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          <ThemeProvider attribute="class" defaultTheme="light" enableSystem={false}>
            <AppProviders>{children}</AppProviders>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
