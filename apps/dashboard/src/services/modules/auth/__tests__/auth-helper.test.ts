import { ApiError } from "@schoolhub/api-client";
import { isUnusableLinkError, readLinkFragment } from "../auth-helper";

describe("readLinkFragment", () => {
  it("reads every key out of the fragment", () => {
    expect(readLinkFragment("#school=demo&token=abc123", ["school", "token"])).toEqual({
      school: "demo",
      token: "abc123",
    });
  });

  it("decodes percent-encoded values", () => {
    const keys = ["school", "uid", "token"] as const;
    const link = readLinkFragment("#school=demo&uid=MQ%3D%3D&token=t-1", keys);
    expect(link).toEqual({ school: "demo", uid: "MQ==", token: "t-1" });
  });

  it("is null when a key is missing or empty", () => {
    expect(readLinkFragment("#school=demo", ["school", "token"])).toBeNull();
    expect(readLinkFragment("#school=demo&token=", ["school", "token"])).toBeNull();
    expect(readLinkFragment("", ["school", "token"])).toBeNull();
  });
});

function linkError(code: string, field?: string) {
  return new ApiError({
    code,
    message: "Refused.",
    status: 400,
    url: "/auth/invitations:accept",
    details: field ? [{ field, issue: "Not valid." }] : [],
  });
}

describe("isUnusableLinkError", () => {
  it("is true for the API's invalid_link", () => {
    expect(isUnusableLinkError(linkError("invalid_link"))).toBe(true);
  });

  it("is true for a validation_error on a link value", () => {
    expect(isUnusableLinkError(linkError("validation_error", "school"))).toBe(true);
    expect(isUnusableLinkError(linkError("validation_error", "uid"))).toBe(true);
  });

  it("is false for a weak password, which the form shows under the field", () => {
    expect(isUnusableLinkError(linkError("validation_error", "password"))).toBe(false);
    expect(isUnusableLinkError(linkError("validation_error", "new_password"))).toBe(false);
  });

  it("is false for anything that is not an API error", () => {
    expect(isUnusableLinkError(new Error("boom"))).toBe(false);
    expect(isUnusableLinkError(null)).toBe(false);
  });
});
