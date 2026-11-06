import { ApiError } from "@schoolhub/api-client";

import { keepServerMessage } from "../keep-server-message";
import { NON_FIELD } from "../error-message";

describe("keepServerMessage", () => {
  it("re-keys the server's sentence as the form's own message, keeping the rest of the error", () => {
    const original = new ApiError({
      code: "conflict",
      message: "This exam is published and its configuration is frozen.",
      status: 409,
      url: "/exams/e1",
      details: [],
      requestId: "req-1",
    });

    const kept = keepServerMessage(original);

    expect(kept.fieldErrors()).toEqual({ [NON_FIELD]: original.message });
    expect(kept).toMatchObject({ code: "conflict", status: 409, requestId: "req-1" });
  });
});
