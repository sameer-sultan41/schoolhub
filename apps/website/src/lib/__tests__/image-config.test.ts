import { PUBLIC_FILES_PATHNAME, imagesConfig } from "../image-config";

describe("imagesConfig", () => {
  it("allows only the public API origin's file route", () => {
    expect(imagesConfig({ apiOrigin: "https://api.schoolhub.pk", allowLocalIP: false })).toEqual({
      remotePatterns: [
        {
          protocol: "https",
          hostname: "api.schoolhub.pk",
          port: "",
          pathname: PUBLIC_FILES_PATHNAME,
          search: "",
        },
      ],
    });
  });

  it("keeps an http origin's port (compose, the live lane)", () => {
    const config = imagesConfig({ apiOrigin: "http://api.localhost:8000", allowLocalIP: true });
    expect(config.remotePatterns).toEqual([
      expect.objectContaining({ protocol: "http", hostname: "api.localhost", port: "8000" }),
    ]);
    expect(config.dangerouslyAllowLocalIP).toBe(true);
  });

  it("never allows local IPs unless asked", () => {
    const config = imagesConfig({ apiOrigin: "https://api.schoolhub.pk", allowLocalIP: false });
    expect(config).not.toHaveProperty("dangerouslyAllowLocalIP");
  });

  it("allows no remote image without an API origin", () => {
    expect(imagesConfig({ apiOrigin: "", allowLocalIP: false })).toEqual({ remotePatterns: [] });
  });

  it("keeps the default redirect limit, which covers the file route's single 302", () => {
    expect(
      imagesConfig({ apiOrigin: "https://api.schoolhub.pk", allowLocalIP: false }),
    ).not.toHaveProperty("maximumRedirects");
  });

  it("refuses an origin that is not http(s)", () => {
    expect(() => imagesConfig({ apiOrigin: "ftp://files.example", allowLocalIP: false })).toThrow(
      /http\(s\) origin/,
    );
  });
});
