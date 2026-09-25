import { stableSignedUrl } from "../stable-signed-url";

/** A SigV4-shaped link for `path`, signed at `signedAt` (UTC) and valid for `ttlSeconds`. */
function signedLink(path: string, signedAt: string, ttlSeconds = 3600) {
  return (
    `http://localhost:9000/schoolhub-dev/${path}?X-Amz-Algorithm=AWS4-HMAC-SHA256` +
    `&X-Amz-Date=${signedAt}&X-Amz-Expires=${String(ttlSeconds)}&X-Amz-Signature=${signedAt}`
  );
}

const T0 = Date.UTC(2026, 8, 24, 18, 0, 0); // 20260924T180000Z

// Each test uses its own object path: the helper remembers links for the whole session.
describe("stableSignedUrl", () => {
  it("keeps the link already in use for the same photo while it has time left", () => {
    const first = signedLink("a.png", "20260924T180000Z");
    const refetched = signedLink("a.png", "20260924T181000Z");

    expect(stableSignedUrl(first, T0)).toBe(first);
    expect(stableSignedUrl(refetched, T0 + 10 * 60_000)).toBe(first);
  });

  it("adopts the fresh link once the one in use is about to expire", () => {
    const first = signedLink("b.png", "20260924T180000Z");
    const refetched = signedLink("b.png", "20260924T185700Z");

    stableSignedUrl(first, T0);

    // 57 minutes in: the first link has 3 minutes left, under the 5-minute margin.
    expect(stableSignedUrl(refetched, T0 + 57 * 60_000)).toBe(refetched);
  });

  it("never swaps one photo's link for another's", () => {
    const one = signedLink("c.png", "20260924T180000Z");
    const other = signedLink("d.png", "20260924T180000Z");

    stableSignedUrl(one, T0);

    expect(stableSignedUrl(other, T0)).toBe(other);
  });

  it("passes through a string that isn't a URL at all, rather than throwing", () => {
    expect(stableSignedUrl("not a url", T0)).toBe("not a url");
  });

  it("passes through links it cannot date, and null", () => {
    const first = "https://null-presigner.invalid/tenants/t/e.png";
    const second = "https://null-presigner.invalid/tenants/t/e.png?v=2";

    stableSignedUrl(first, T0);

    expect(stableSignedUrl(second, T0)).toBe(second);
    expect(stableSignedUrl(null, T0)).toBeNull();
  });
});
