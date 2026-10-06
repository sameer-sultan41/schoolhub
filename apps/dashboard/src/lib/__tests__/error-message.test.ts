import { ApiError } from "@schoolhub/api-client";

import {
  applyServerFieldErrors,
  resolveErrorMessage,
  type ErrorCodeTranslator,
} from "../error-message";

const translations: Record<string, string> = {
  permission_denied: "You do not have permission to do that.",
};
const tErrors: ErrorCodeTranslator = Object.assign((key: string) => translations[key] ?? key, {
  has: (key: string) => key in translations,
});

function apiError(code: string, details: { field: string; issue: string }[] = []) {
  return new ApiError({
    code,
    message: `Raw ${code} message.`,
    status: 422,
    url: "/x",
    details: details.map((detail) => ({ ...detail, code })),
  });
}

describe("resolveErrorMessage", () => {
  it("uses the fallback for anything that isn't an ApiError", () => {
    expect(resolveErrorMessage(new Error("boom"), tErrors, "Could not start.")).toBe(
      "Could not start.",
    );
  });

  it("prefers the code's own translation over the raw message", () => {
    expect(resolveErrorMessage(apiError("permission_denied"), tErrors, "fallback")).toBe(
      "You do not have permission to do that.",
    );
  });

  it("falls back to the API's raw message for an untranslated code", () => {
    expect(resolveErrorMessage(apiError("something_new"), tErrors, "fallback")).toBe(
      "Raw something_new message.",
    );
  });

  it("prefers the named field's detail over the code's translation", () => {
    const error = apiError("permission_denied", [{ field: "file", issue: "File too large." }]);
    expect(resolveErrorMessage(error, tErrors, "fallback", "file")).toBe("File too large.");
  });

  it("ignores field details unless a field is named, and falls through when that field has none", () => {
    const error = apiError("permission_denied", [{ field: "file", issue: "File too large." }]);
    expect(resolveErrorMessage(error, tErrors, "fallback")).toBe(
      "You do not have permission to do that.",
    );
    expect(resolveErrorMessage(error, tErrors, "fallback", "name")).toBe(
      "You do not have permission to do that.",
    );
  });
});

describe("applyServerFieldErrors", () => {
  function formStub() {
    return { setError: jest.fn(), clearErrors: jest.fn() };
  }

  it("maps a matched field onto the form and never calls setFormError", () => {
    const form = formStub();
    const setFormError = jest.fn();
    const error = apiError("unprocessable", [
      { field: "phone", issue: "Enter a valid phone number." },
    ]);

    applyServerFieldErrors({
      error,
      form,
      knownFields: ["first_name", "last_name", "phone"],
      tErrors,
      fallback: "fallback",
      setFormError,
    });

    expect(form.clearErrors).toHaveBeenCalled();
    expect(form.setError).toHaveBeenCalledWith("phone", {
      type: "server",
      message: "Enter a valid phone number.",
    });
    expect(setFormError).not.toHaveBeenCalledWith(expect.any(String));
  });

  it("falls back to setFormError with the resolved message when nothing matches a known field", () => {
    const form = formStub();
    const setFormError = jest.fn();
    const error = apiError("permission_denied", [{ field: "unknown_field", issue: "Nope." }]);

    applyServerFieldErrors({
      error,
      form,
      knownFields: ["first_name", "last_name", "phone"],
      tErrors,
      fallback: "fallback",
      setFormError,
    });

    expect(form.setError).not.toHaveBeenCalled();
    expect(setFormError).toHaveBeenCalledWith("You do not have permission to do that.");
  });
});
