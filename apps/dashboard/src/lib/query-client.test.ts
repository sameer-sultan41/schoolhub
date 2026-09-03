import { ApiError } from "@schoolhub/api-client";
import { getQueryClient, makeQueryClient, queryKeys } from "./query-client";

function makeApiError(status: number): ApiError {
  return new ApiError({ code: "x", message: "x", status, url: "/x" });
}

describe("makeQueryClient retry policy", () => {
  function retry(failureCount: number, error: unknown): boolean {
    const client = makeQueryClient();
    const shouldRetry = client.getDefaultOptions().queries?.retry;
    if (typeof shouldRetry !== "function") throw new Error("retry must be a function");
    return shouldRetry(failureCount, error as never);
  }

  it("never retries past two attempts", () => {
    expect(retry(2, makeApiError(500))).toBe(false);
  });

  it("retries a transport failure (status 0)", () => {
    expect(retry(0, makeApiError(0))).toBe(true);
  });

  it("retries a 5xx server error", () => {
    expect(retry(0, makeApiError(503))).toBe(true);
  });

  it("retries a 429 rate-limit", () => {
    expect(retry(0, makeApiError(429))).toBe(true);
  });

  it("does not retry a 4xx client error", () => {
    expect(retry(0, makeApiError(403))).toBe(false);
    expect(retry(0, makeApiError(422))).toBe(false);
  });

  it("does not retry a non-ApiError", () => {
    expect(retry(0, new Error("boom"))).toBe(false);
  });

  it("never retries a mutation", () => {
    const client = makeQueryClient();
    expect(client.getDefaultOptions().mutations?.retry).toBe(false);
  });
});

describe("getQueryClient", () => {
  it("returns the same instance across calls in the browser", () => {
    const first = getQueryClient();
    const second = getQueryClient();
    expect(first).toBe(second);
  });
});

describe("queryKeys", () => {
  it("builds stable, module-first keys", () => {
    expect(queryKeys.session()).toEqual(["session"]);
    expect(queryKeys.tenant()).toEqual(["tenant"]);
    expect(queryKeys.module("fees")).toEqual(["fees"]);
    expect(queryKeys.list("fees", "invoices")).toEqual(["fees", "invoices", "list", {}]);
    expect(queryKeys.list("fees", "invoices", { status: "overdue" })).toEqual([
      "fees",
      "invoices",
      "list",
      { status: "overdue" },
    ]);
    expect(queryKeys.detail("fees", "invoices", "inv-1")).toEqual([
      "fees",
      "invoices",
      "detail",
      "inv-1",
    ]);
  });
});
