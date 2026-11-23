import type { NextConfig } from "next";
import { IMAGE_HOSTNAME_PATTERN } from "./regex";

type ImagesConfig = NonNullable<NextConfig["images"]>;
type RemotePattern = Exclude<NonNullable<ImagesConfig["remotePatterns"]>[number], URL>;

/** Where the API serves public files (`website_cms/media.py` `PUBLIC_FILE_PATH`); each 302s to storage. */
export const PUBLIC_FILES_PATHNAME = "/api/v1/public/files/**";

/**
 * How long the optimiser keeps an optimised image (disk cache and the `Cache-Control` it sends).
 * Equal to the API's `PUBLIC_FILE_CACHE_SECONDS` (`website_cms/constants.py`), the public file
 * redirect's own max-age, so an image that is unpublished stops being served as fast as the API
 * stops serving it. Next's default is 14400 s, and it has no per-image invalidation.
 */
export const IMAGE_CACHE_SECONDS = 300;

/**
 * The image optimiser's allow-list (website-cms plan, decision 4).
 *
 * - **Source.** Only the API's file route over https: every CMS image URL is
 *   `<API_PUBLIC_URL>/api/v1/public/files/<tenant>/<file>`. Each hostname pattern (the build's
 *   `WEBSITE_IMAGE_HOSTNAME`, the same in every environment) becomes one pattern. A pattern like
 *   `**.<domain>` also matches tenant hosts, but on this path those reach the renderer, which
 *   answers 404, so only the API's file route serves an image. No hostname allows no remote image.
 * - **Redirect.** That route answers 302 to a presigned storage URL. Next follows up to
 *   `maximumRedirects` (default 3) hops without re-checking `remotePatterns`, so the single hop
 *   needs neither a storage pattern nor a raised limit (Next 16 `images` docs, `image-optimizer.js`).
 *   The private-IP check does apply to every hop.
 * - **Local stacks.** `unoptimized` only when explicitly enabled (compose, the E2E lanes): their API is
 *   on a local http address, which the optimiser refuses, so the browser loads the public URL itself.
 *   The optimiser is never allowed to fetch from local addresses (`dangerouslyAllowLocalIP`).
 * - **Lifetime.** `minimumCacheTTL` is `IMAGE_CACHE_SECONDS`, not Next's 4 h default.
 */
export function imagesConfig({
  hostnames,
  unoptimized,
}: {
  hostnames: readonly string[];
  unoptimized: boolean;
}): ImagesConfig {
  // A build that names an image hostname is a deployed one: the optimiser must stay on there.
  if (unoptimized && hostnames.length > 0) {
    throw new Error(
      "WEBSITE_IMAGES_UNOPTIMIZED is for local stacks only, not with WEBSITE_IMAGE_HOSTNAME",
    );
  }
  return {
    remotePatterns: hostnames.map(publicFilesPattern),
    minimumCacheTTL: IMAGE_CACHE_SECONDS,
    ...(unoptimized ? { unoptimized: true } : {}),
  };
}

function publicFilesPattern(hostname: string): RemotePattern {
  if (!IMAGE_HOSTNAME_PATTERN.test(hostname)) {
    throw new Error(
      `WEBSITE_IMAGE_HOSTNAME must list hostnames (no scheme, port or path), got ${hostname}`,
    );
  }
  return {
    protocol: "https",
    hostname,
    port: "",
    pathname: PUBLIC_FILES_PATHNAME,
    search: "",
  };
}
