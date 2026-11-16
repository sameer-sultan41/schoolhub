import { ApiError } from "@schoolhub/api-client";

import { reasonText, withReasonText } from "../reason-message";

jest.mock("@/services", () =>
  jest
    .requireActual<{
      servicesMock: (domains: Record<string, readonly string[]>) => unknown;
    }>("@/test-fixtures/services-mock")
    .servicesMock({}),
);

const KNOWN: Record<string, string> = {
  page_in_use: "This page is in use.",
  slug_taken: "Another page already uses this address.",
  "content.slug_taken": "Another item already uses this address.",
};
const tReasons = Object.assign((key: string) => KNOWN[key] ?? key, {
  has: (key: string) => key in KNOWN,
});

describe("reason messages", () => {
  it("translates a known reason, and keeps an unknown one's sentence", () => {
    expect(reasonText("page_in_use: it is the homepage.", tReasons)).toBe("This page is in use.");
    expect(reasonText("slug_taken: another page already uses this address.", tReasons)).toBe(
      "Another page already uses this address.",
    );
    expect(reasonText("This field is required.", tReasons)).toBe("This field is required.");
    expect(reasonText("empty_album: add at least one item before publishing.", tReasons)).toBe(
      "Add at least one item before publishing.",
    );
  });

  it("prefers a scope's own copy, and falls back to the shared one", () => {
    const issue = "slug_taken: another item already uses this address.";

    expect(reasonText(issue, tReasons, "content")).toBe("Another item already uses this address.");
    expect(reasonText(issue, tReasons)).toBe("Another page already uses this address.");
    expect(reasonText("page_in_use: it is the homepage.", tReasons, "content")).toBe(
      "This page is in use.",
    );
  });

  it("rewrites every detail of an API error, and leaves anything else alone", () => {
    const error = new ApiError({
      code: "domain_rule_violation",
      message: "page_in_use: it is the homepage.",
      status: 422,
      url: "/website-pages/1",
      details: [{ field: "page", issue: "page_in_use: it is the homepage." }],
      meta: { reason: "page_in_use" },
    });

    const rewritten = withReasonText(error, tReasons);

    expect(rewritten).toBeInstanceOf(ApiError);
    expect((rewritten as ApiError).details).toEqual([
      { field: "page", issue: "This page is in use." },
    ]);
    expect((rewritten as ApiError).meta).toEqual({ reason: "page_in_use" });
    const plain = new Error("boom");
    expect(withReasonText(plain, tReasons)).toBe(plain);
  });
});
