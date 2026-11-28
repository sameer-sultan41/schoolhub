import { seoTargetKey, toSeoTargetParams } from "../seo-settings-helper";

describe("seo-settings-helper", () => {
  it("sends the site row by type alone, and a record's by type and id", () => {
    expect(toSeoTargetParams({ targetType: "site" })).toEqual({ target_type: "site" });
    expect(toSeoTargetParams({ targetType: "news_post", targetId: "n1" })).toEqual({
      target_type: "news_post",
      target_id: "n1",
    });
  });

  it("keys each target's cache entry apart", () => {
    expect(seoTargetKey({ targetType: "site" })).toBe("site");
    expect(seoTargetKey({ targetType: "page", targetId: "p1" })).toBe("page:p1");
    expect(seoTargetKey({ targetType: "gallery_album", targetId: "p1" })).toBe("gallery_album:p1");
  });
});
