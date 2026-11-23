import { serializeJsonLd } from "../json-ld";

describe("serializeJsonLd", () => {
  it("escapes every character that could end the script element", () => {
    const json = serializeJsonLd({ headline: "</script><script>alert(1)</script> & more" });

    expect(json).not.toContain("<");
    expect(json).not.toContain(">");
    expect(json).not.toContain("&");
    expect(json).toContain("\\u003c/script\\u003e");
  });

  it("escapes the U+2028 and U+2029 line separators", () => {
    const json = serializeJsonLd({ headline: "a\u2028b\u2029c" });
    expect(json).toBe('{"headline":"a\\u2028b\\u2029c"}');
  });

  it("still parses back to the original data", () => {
    const data = { "@type": "NewsArticle", headline: "</script> & <b>\u2028", count: 2 };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });

  it("drops undefined properties, as JSON does", () => {
    expect(serializeJsonLd({ a: "x", b: undefined })).toBe('{"a":"x"}');
  });
});
