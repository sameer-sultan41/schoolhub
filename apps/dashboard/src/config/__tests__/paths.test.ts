import { mfaVerifyPath } from "../paths";

describe("mfaVerifyPath", () => {
  it("carries a same-origin next through the second factor", () => {
    const target = new URL(mfaVerifyPath("/platform/plans"), "https://app.schoolhub.test");
    expect(target.pathname).toBe("/mfa/verify");
    expect(target.searchParams.get("next")).toBe("/platform/plans");
  });

  it.each([null, undefined, "//evil.example", "/\\evil.example", "https://evil.example"])(
    "drops %p",
    (next) => {
      expect(mfaVerifyPath(next)).toBe("/mfa/verify");
    },
  );
});
