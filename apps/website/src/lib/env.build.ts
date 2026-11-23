import { z } from "zod";

/**
 * Build-time configuration, read by `next.config.ts` (the image optimiser's allow-list is fixed
 * when the config loads, so a standalone build fixes it at `next build`).
 *
 * - `WEBSITE_IMAGE_HOSTNAME`: the API hosts the file route is served from, comma-separated,
 *   e.g. `api.schoolhub.example,api.staging.schoolhub.example`. It must be the **same value for
 *   every environment**, because one image is promoted from staging to production unchanged
 *   (`infra/AGENTS.md` rule 5), so it lists every environment's API host. Prefer that exact list
 *   to a `**.<prod domain>` wildcard, which also admits tenant subdomains. Empty allows no
 *   remote image.
 * - `WEBSITE_IMAGES_UNOPTIMIZED` turns the optimiser off, so the browser loads each image from its
 *   public URL. Only compose and the E2E lanes set it: their API is on a local address the
 *   optimiser cannot (and must not) fetch from. Production leaves it off.
 */
const buildEnvSchema = z.object({
  WEBSITE_IMAGE_HOSTNAME: z
    .string()
    .default("")
    .transform((value) =>
      value
        .split(",")
        .map((hostname) => hostname.trim())
        .filter(Boolean),
    ),
  WEBSITE_IMAGES_UNOPTIMIZED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

const parsed = buildEnvSchema.safeParse({
  WEBSITE_IMAGE_HOSTNAME: process.env.WEBSITE_IMAGE_HOSTNAME,
  WEBSITE_IMAGES_UNOPTIMIZED: process.env.WEBSITE_IMAGES_UNOPTIMIZED,
});

if (!parsed.success) {
  throw new Error(`Invalid website build configuration:\n${z.prettifyError(parsed.error)}`);
}

export const buildEnv = parsed.data;
