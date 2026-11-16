import { z } from "zod";
import { publicEnv } from "./env.client";

/**
 * Build-time configuration, read by `next.config.ts` (the image optimiser's allow-list is fixed
 * when the config loads, so a standalone build fixes it at `next build`).
 *
 * `WEBSITE_IMAGES_ALLOW_LOCAL_IP` lets the optimiser fetch from a private address. Only compose
 * and the E2E live lane set it, where the API is on a local network; production never does,
 * because it would expose the internal network to the optimiser (an SSRF risk).
 */
const buildEnvSchema = z.object({
  WEBSITE_IMAGES_ALLOW_LOCAL_IP: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
});

const parsed = buildEnvSchema.safeParse({
  WEBSITE_IMAGES_ALLOW_LOCAL_IP: process.env.WEBSITE_IMAGES_ALLOW_LOCAL_IP,
});

if (!parsed.success) {
  throw new Error(`Invalid website build configuration:\n${z.prettifyError(parsed.error)}`);
}

export const buildEnv = {
  /** Declared once in `env.client.ts`: the public API origin the browser and image URLs use. */
  NEXT_PUBLIC_API_ORIGIN: publicEnv.NEXT_PUBLIC_API_ORIGIN,
  ...parsed.data,
};
