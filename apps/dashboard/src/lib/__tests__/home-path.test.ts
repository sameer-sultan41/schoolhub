import { homePathFor } from "../home-path";

describe("homePathFor", () => {
  it("sends a platform operator to the console", () => {
    expect(homePathFor({ is_platform: true })).toBe("/platform");
  });

  it("sends a platform operator to the console even if flagged restricted", () => {
    // `is_platform` wins: a platform account has no school, so no portal or staff home.
    expect(homePathFor({ is_platform: true, is_restricted_principal: true })).toBe("/platform");
  });

  it("sends a student or guardian to the portal", () => {
    expect(homePathFor({ is_restricted_principal: true })).toBe("/portal");
  });

  it("sends school staff to the dashboard", () => {
    expect(homePathFor({ is_platform: false, is_restricted_principal: false })).toBe("/dashboard");
    expect(homePathFor({})).toBe("/dashboard");
  });
});
