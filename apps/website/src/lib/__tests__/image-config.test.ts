import { IMAGE_CACHE_SECONDS, PUBLIC_FILES_PATHNAME, imagesConfig } from "../image-config";

// The one build value every environment shares: `api.<domain>` and `api.staging.<domain>` both match.
const WILDCARD = "**.schoolhub.example";

describe("imagesConfig", () => {
  it("allows only the API's https file route on each configured hostname", () => {
    expect(imagesConfig({ hostnames: [WILDCARD], unoptimized: false })).toEqual({
      remotePatterns: [
        {
          protocol: "https",
          hostname: WILDCARD,
          port: "",
          pathname: PUBLIC_FILES_PATHNAME,
          search: "",
        },
      ],
      minimumCacheTTL: IMAGE_CACHE_SECONDS,
    });
  });

  it("builds one pattern per hostname for a comma list", () => {
    const config = imagesConfig({
      hostnames: ["api.schoolhub.example", "api.other.example"],
      unoptimized: false,
    });
    expect(config.remotePatterns).toEqual([
      expect.objectContaining({ protocol: "https", hostname: "api.schoolhub.example" }),
      expect.objectContaining({ protocol: "https", hostname: "api.other.example" }),
    ]);
  });

  it("turns the optimiser off only when asked (compose, the E2E lanes)", () => {
    expect(imagesConfig({ hostnames: [], unoptimized: true }).unoptimized).toBe(true);
    expect(imagesConfig({ hostnames: [WILDCARD], unoptimized: false })).not.toHaveProperty(
      "unoptimized",
    );
  });

  it("refuses to turn the optimiser off for a deployed build that names an image hostname", () => {
    expect(() => imagesConfig({ hostnames: [WILDCARD], unoptimized: true })).toThrow(
      /local stacks only/,
    );
  });

  it("never lets the optimiser fetch from a local address", () => {
    for (const unoptimized of [true, false]) {
      expect(imagesConfig({ hostnames: [], unoptimized })).not.toHaveProperty(
        "dangerouslyAllowLocalIP",
      );
    }
  });

  it("allows no remote image without a hostname", () => {
    expect(imagesConfig({ hostnames: [], unoptimized: false })).toMatchObject({
      remotePatterns: [],
    });
  });

  it("keeps the default redirect limit, which covers the file route's single 302", () => {
    expect(imagesConfig({ hostnames: [WILDCARD], unoptimized: false })).not.toHaveProperty(
      "maximumRedirects",
    );
  });

  it("keeps optimised images no longer than the API's public file cache (300 s)", () => {
    // Next's default (14400 s) would keep an unpublished image for 4 hours.
    expect(IMAGE_CACHE_SECONDS).toBe(300);
    expect(imagesConfig({ hostnames: [WILDCARD], unoptimized: false }).minimumCacheTTL).toBe(
      IMAGE_CACHE_SECONDS,
    );
  });

  it.each([
    "https://api.schoolhub.example",
    "api.schoolhub.example:8443",
    "api.example/files",
    "api.*.example",
  ])("refuses %s, which is not a bare hostname pattern", (hostname) => {
    expect(() => imagesConfig({ hostnames: [hostname], unoptimized: false })).toThrow(
      /WEBSITE_IMAGE_HOSTNAME must list hostnames/,
    );
  });
});
