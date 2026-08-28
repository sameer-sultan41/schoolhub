import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "SchoolHub",
  robots: { index: false, follow: false },
};

/**
 * Shown when the Host header matches no tenant (the platform apex, a reserved subdomain,
 * or an unverified domain). Deliberately generic: an unknown host must never fall through
 * to a tenant's content.
 */
export default function PlatformLandingPage() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-heading text-2xl font-semibold text-foreground">SchoolHub</h1>
      <p className="mt-3 text-foreground/75">
        No school website is configured for this address.
      </p>
    </main>
  );
}
