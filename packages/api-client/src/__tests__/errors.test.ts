import { ApiError, codeForStatus, parseErrorEnvelope } from "./errors";

function error(status: number, code = "x"): ApiError {
  return new ApiError({ code, message: "m", status, url: "/students" });
}

describe("ApiError status predicates", () => {
  it("classifies each status the callers branch on", () => {
    expect(error(401).isUnauthenticated).toBe(true);
    expect(error(403).isPermissionDenied).toBe(true);
    expect(error(404).isNotFound).toBe(true);
    expect(error(400).isValidation).toBe(true);
    expect(error(422).isValidation).toBe(true);
    expect(error(429).isRateLimited).toBe(true);
    expect(error(503).isServerError).toBe(true);
  });

  it.each([0, 429, 500, 503])("treats %s as transient", (status) => {
    expect(error(status).isTransient).toBe(true);
  });

  it.each([400, 401, 403, 404, 409, 422])("treats %s as an answer, not a blip", (status) => {
    // A 4xx other than 429 says something about the request itself, so retrying it just
    // delays the error the user needs to see — and a 401 here must never be mistaken for
    // "try again later" by the auth path.
    expect(error(status).isTransient).toBe(false);
  });

  it("exposes field errors ready for setError, first issue per field winning", () => {
    const err = new ApiError({
      code: "validation_error",
      message: "m",
      status: 400,
      url: "/students",
      details: [
        { field: "email", issue: "Invalid." },
        { field: "email", issue: "Also taken." },
        { issue: "A non-field problem." },
      ],
    });

    expect(err.fieldErrors()).toEqual({ email: "Invalid." });
  });

  it("keeps the underlying cause for a transport failure", () => {
    const cause = new TypeError("offline");
    const err = new ApiError({
      code: "network_error",
      message: "m",
      status: 0,
      url: "/students",
      cause,
    });

    expect(err.cause).toBe(cause);
    expect(err.name).toBe("ApiError");
  });
});

describe("codeForStatus", () => {
  it.each([
    [400, "validation_error"],
    [401, "unauthenticated"],
    [403, "permission_denied"],
    [404, "not_found"],
    [405, "method_not_allowed"],
    [409, "conflict"],
    [422, "unprocessable"],
    [429, "rate_limited"],
    [500, "server_error"],
    [418, "request_failed"],
  ])("maps %s to %s", (status, code) => {
    expect(codeForStatus(status)).toBe(code);
  });
});

describe("parseErrorEnvelope", () => {
  it("extracts a well-formed envelope", () => {
    expect(
      parseErrorEnvelope({
        error: {
          code: "validation_error",
          message: "Bad.",
          details: [{ field: "email", issue: "Invalid.", code: "invalid" }],
          request_id: "req-1",
        },
      }),
    ).toEqual({
      code: "validation_error",
      message: "Bad.",
      details: [{ field: "email", issue: "Invalid.", code: "invalid" }],
      request_id: "req-1",
    });
  });

  it("skips detail entries with no issue string", () => {
    const parsed = parseErrorEnvelope({
      error: { code: "c", message: "m", details: [{ field: "email" }, "nope", { issue: "ok" }] },
    });

    expect(parsed?.details).toEqual([{ issue: "ok" }]);
  });

  it.each([null, "string", 42, {}, { error: "not-an-object" }, { error: { code: 1 } }])(
    "returns null for a payload that is not an envelope (%p)",
    (payload) => {
      expect(parseErrorEnvelope(payload)).toBeNull();
    },
  );
});
