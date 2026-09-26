import { z } from "zod";

/**
 * Public renderer configuration for client components (ADR-0014) — `NEXT_PUBLIC_*` values only.
 * Server code (route handlers, the proxy, server components) reads `./env.ts` instead, which also
 * holds the secrets and must never be imported from a client component.
 *
 * Each value is a literal `process.env.NEXT_PUBLIC_…` expression, the form Next.js inlines into
 * the client bundle — and inlines at `next build`. So nothing here may be *required*: an image
 * built without build-time values (apps/website/Dockerfile sets none) would otherwise crash
 * every client component that imports this module on hydration.
 */
const publicEnvSchema = z.object({
  /**
   * Origin the browser posts public forms to. Empty means same-origin (a reverse proxy in
   * front of both the renderer and the API).
   */
  NEXT_PUBLIC_API_ORIGIN: z.string().default(""),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_API_ORIGIN: process.env.NEXT_PUBLIC_API_ORIGIN,
});

if (!parsed.success) {
  throw new Error(`Invalid public website configuration:\n${z.prettifyError(parsed.error)}`);
}

export const publicEnv = parsed.data;
