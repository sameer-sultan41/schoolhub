import { z } from "zod";

/**
 * Public renderer configuration — `NEXT_PUBLIC_*` values only, safe to import from client
 * components and the proxy (ADR-0014). Server secrets live in `./env.ts`, which must never be
 * imported from a client component.
 *
 * Each value is referenced as a literal `process.env.NEXT_PUBLIC_…` expression: that is the
 * form Next.js inlines into the client bundle at build time.
 */
const publicEnvSchema = z.object({
  /** Apex domain for tenant wildcard subdomains: `<slug>.<platform-domain>`. */
  NEXT_PUBLIC_PLATFORM_DOMAIN: z.string().min(1),
  /**
   * Origin the browser posts public forms to. Empty means same-origin (a reverse proxy in
   * front of both the renderer and the API).
   */
  NEXT_PUBLIC_API_ORIGIN: z.string().default(""),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_PLATFORM_DOMAIN: process.env.NEXT_PUBLIC_PLATFORM_DOMAIN,
  NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
});

if (!parsed.success) {
  throw new Error(`Invalid public website configuration:\n${z.prettifyError(parsed.error)}`);
}

export const publicEnv = parsed.data;
