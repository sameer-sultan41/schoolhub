import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import type { ReactNode } from "react";
import { AppProviders } from "@/components/providers";
import { directionFor } from "@/lib/env";
import "./globals.css";

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
    <html lang={locale} dir={directionFor(locale)} className="h-full">
      <body className="min-h-full font-sans">
        <NextIntlClientProvider locale={locale} messages={messages}>
          <AppProviders>{children}</AppProviders>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
