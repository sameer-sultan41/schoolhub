import { safeNextPath } from "../safe-next-path";

describe("safeNextPath", () => {
  it("keeps a same-origin path, with its query and fragment", () => {
    expect(safeNextPath("/platform/plans")).toBe("/platform/plans");
    expect(safeNextPath("/students?tab=active#top")).toBe("/students?tab=active#top");
  });

  it.each([
    ["a protocol-relative URL", "//evil.example"],
    ["a backslash the browser reads as a slash", "/\\evil.example"],
    ["a tab the browser strips before the second slash", "/\t/evil.example"],
    ["an absolute URL", "https://evil.example/login"],
    ["a scheme with no slashes", "javascript:alert(1)"],
    ["a relative path", "platform"],
    // Dot segments a parser resolves into a protocol-relative path: the input's origin is the
    // sentinel's, but the path it returns is `//evil.example`.
    ["a parent segment before a double slash", "/..//evil.example"],
    ["a current segment before a double slash", "/.//evil.example"],
    ["a segment climbed back out of", "/a/..//evil.example"],
    ["an encoded parent segment", "/%2e%2e//evil.example"],
    ["a parent segment before a backslash", "/x/../\\evil.example"],
    ["a newline smuggled between the slashes", "/\n/evil.example"],
    ["a carriage return smuggled between the slashes", "/\r/evil.example"],
    ["a mixed-case scheme", "JavaScript:alert(1)"],
    ["a leading space", " /platform"],
  ])("refuses %s", (_case, next) => {
    expect(safeNextPath(next)).toBeNull();
  });

  it("keeps encoded slashes as a same-origin path, since they are not path separators", () => {
    expect(safeNextPath("/%2F%2F/evil.example")).toBe("/%2F%2F/evil.example");
    expect(safeNextPath("/%5C/evil.example")).toBe("/%5C/evil.example");
  });

  it("keeps an encoded tab as a same-origin path", () => {
    expect(safeNextPath("/%09/evil")).toBe("/%09/evil");
  });

  it("refuses nothing at all", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });
});
