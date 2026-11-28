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
  ])("refuses %s", (_case, next) => {
    expect(safeNextPath(next)).toBeNull();
  });

  it("refuses nothing at all", () => {
    expect(safeNextPath(null)).toBeNull();
    expect(safeNextPath(undefined)).toBeNull();
    expect(safeNextPath("")).toBeNull();
  });
});
