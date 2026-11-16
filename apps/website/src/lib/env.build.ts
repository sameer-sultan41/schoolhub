import { z } from "zod";
import { publicEnv } from "./env.client";

/**
 * Build-time configuration, read by `next.config.ts` (the image optimiser's allow-list is fixed
 * when the config loads, so a standalone build fixes it at `next build`).
 *
 * `WEBSITE_IMAGES_UNOPTIMIZED` turns the optimiser off, so the browser loads each image from its
 * public URL. Only compose and the E2E lanes set it: their API is on a local address the optimiser
 * cannot (and must not) fetch from. Production leaves it off and optimises the API's file route.
 */
const buildEnvSchema = z.object({
  WEBSITE_IMAGES_UNOPTIMIZED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

const parsed = buildEnvSchema.safeParse({
  WEBSITE_IMAGES_UNOPTIMIZED: process.env.WEBSITE_IMAGES_UNOPTIMIZED,
});

if (!parsed.success) {
  throw new Error(`Invalid website build configuration:\n${z.prettifyError(parsed.error)}`);
}

export const buildEnv = {
  /** Declared once in `env.client.ts`: the public API origin the browser and image URLs use. */
  NEXT_PUBLIC_API_ORIGIN: publicEnv.NEXT_PUBLIC_API_ORIGIN,
  ...parsed.data,
};
