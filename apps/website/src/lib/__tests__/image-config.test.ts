import { IMAGE_CACHE_SECONDS, PUBLIC_FILES_PATHNAME, imagesConfig } from "../image-config";

describe("imagesConfig", () => {
  it("allows only the public API origin's file route", () => {
    expect(imagesConfig({ apiOrigin: "https://api.schoolhub.pk", unoptimized: false })).toEqual({
      remotePatterns: [
        {
          protocol: "https",
          hostname: "api.schoolhub.pk",
          port: "",
          pathname: PUBLIC_FILES_PATHNAME,
          search: "",
        },
      ],
      minimumCacheTTL: IMAGE_CACHE_SECONDS,
    });
  });

  it("keeps an http origin's port (compose, the live lane)", () => {
    const config = imagesConfig({ apiOrigin: "http://api.localhost:8000", unoptimized: true });
    expect(config.remotePatterns).toEqual([
      expect.objectContaining({ protocol: "http", hostname: "api.localhost", port: "8000" }),
    ]);
  });

  it("turns the optimiser off only when asked (compose, the E2E lanes)", () => {
    expect(
      imagesConfig({ apiOrigin: "http://api.localhost:8000", unoptimized: true }).unoptimized,
    ).toBe(true);
    expect(
      imagesConfig({ apiOrigin: "https://api.schoolhub.pk", unoptimized: false }),
    ).not.toHaveProperty("unoptimized");
  });

  it("never lets the optimiser fetch from a local address", () => {
    for (const unoptimized of [true, false]) {
      expect(
        imagesConfig({ apiOrigin: "http://api.localhost:8000", unoptimized }),
      ).not.toHaveProperty("dangerouslyAllowLocalIP");
    }
  });

  it("allows no remote image without an API origin", () => {
    expect(imagesConfig({ apiOrigin: "", unoptimized: false })).toMatchObject({
      remotePatterns: [],
    });
  });

  it("keeps the default redirect limit, which covers the file route's single 302", () => {
    expect(
      imagesConfig({ apiOrigin: "https://api.schoolhub.pk", unoptimized: false }),
    ).not.toHaveProperty("maximumRedirects");
  });

  it("keeps optimised images no longer than the API's public file cache (300 s)", () => {
    // Next's default (14400 s) would keep an unpublished image for 4 hours.
    expect(IMAGE_CACHE_SECONDS).toBe(300);
    expect(
      imagesConfig({ apiOrigin: "https://api.schoolhub.pk", unoptimized: false }).minimumCacheTTL,
    ).toBe(IMAGE_CACHE_SECONDS);
    expect(imagesConfig({ apiOrigin: "", unoptimized: false }).minimumCacheTTL).toBe(300);
  });

  it("refuses an origin that is not http(s)", () => {
    expect(() => imagesConfig({ apiOrigin: "ftp://files.example", unoptimized: false })).toThrow(
      /http\(s\) origin/,
    );
  });
});
