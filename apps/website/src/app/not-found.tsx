import { Button } from "@schoolhub/ui";
import Link from "next/link";

/** Shown for an unpublished path, and for a host that resolves to no tenant. */
export default function NotFound() {
  return (
    <main className="mx-auto max-w-xl px-6 py-24 text-center">
      <h1 className="font-heading text-2xl font-semibold text-foreground">Page not found</h1>
      <p className="mt-3 text-foreground/75">
        The page you were looking for does not exist or is no longer published.
      </p>
      <Button asChild size="lg" className="mt-6">
        <Link href="/">Go to the homepage</Link>
      </Button>
    </main>
  );
}
