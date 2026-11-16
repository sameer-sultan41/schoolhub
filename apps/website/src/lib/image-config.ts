import type { NextConfig } from "next";

type ImagesConfig = NonNullable<NextConfig["images"]>;
type RemotePattern = Exclude<NonNullable<ImagesConfig["remotePatterns"]>[number], URL>;

/** Where the API serves public files (`website_cms/media.py` `PUBLIC_FILE_PATH`); each 302s to storage. */
export const PUBLIC_FILES_PATHNAME = "/api/v1/public/files/**";

/**
 * The image optimiser's allow-list (website-cms plan, decision 4).
 *
 * - **Source.** Only the public API origin's file route: every CMS image URL is
 *   `<API_PUBLIC_URL>/api/v1/public/files/<tenant>/<file>`. An empty origin allows no remote image.
 * - **Redirect.** That route answers 302 to a presigned storage URL. Next follows up to
 *   `maximumRedirects` (default 3) hops without re-checking `remotePatterns`, so the single hop
 *   needs neither a storage pattern nor a raised limit (Next 16 `images` docs, `image-optimizer.js`).
 *   The private-IP check does apply to every hop.
 * - **Local IPs.** `dangerouslyAllowLocalIP` only when explicitly enabled (compose, the live lane).
 */
export function imagesConfig({
  apiOrigin,
  allowLocalIP,
}: {
  apiOrigin: string;
  allowLocalIP: boolean;
}): ImagesConfig {
  return {
    remotePatterns: apiOrigin ? [publicFilesPattern(apiOrigin)] : [],
    ...(allowLocalIP ? { dangerouslyAllowLocalIP: true } : {}),
  };
}

function publicFilesPattern(apiOrigin: string): RemotePattern {
  const url = new URL(apiOrigin);
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`NEXT_PUBLIC_API_ORIGIN must be an http(s) origin, got ${url.protocol}`);
  }
  return {
    protocol: url.protocol === "https:" ? "https" : "http",
    hostname: url.hostname,
    port: url.port,
    pathname: PUBLIC_FILES_PATHNAME,
    search: "",
  };
}
