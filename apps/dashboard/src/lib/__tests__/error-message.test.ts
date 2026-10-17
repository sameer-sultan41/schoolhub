import { ApiError } from "@schoolhub/api-client";

import {
  applyServerFieldErrors,
  foldUnknownFieldErrors,
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

  it("falls back to the fallback message, without touching the form, for a non-ApiError", () => {
    const form = formStub();
    const setFormError = jest.fn();

    applyServerFieldErrors({
      error: new Error("network down"),
      form,
      knownFields: ["first_name", "last_name", "phone"],
      tErrors,
      fallback: "Something went wrong.",
      setFormError,
    });

    expect(form.clearErrors).toHaveBeenCalled();
    expect(form.setError).not.toHaveBeenCalled();
    expect(setFormError).toHaveBeenCalledWith("Something went wrong.");
  });
});

describe("foldUnknownFieldErrors", () => {
  it("re-keys a field the dialog has no input for as non_field, so its own reason shows", () => {
    const error = apiError("domain_rule_violation", [
      { field: "elective_group", issue: "Removing this leaves the group with no options." },
    ]);

    const folded = foldUnknownFieldErrors(error);

    expect(folded).toBeInstanceOf(ApiError);
    expect(resolveErrorMessage(folded, tErrors, "fallback", "non_field")).toBe(
      "Removing this leaves the group with no options.",
    );
    // The original is untouched, and the rest of the envelope carries over.
    expect(error.fieldErrors()).toEqual({
      elective_group: "Removing this leaves the group with no options.",
    });
    expect(folded).toMatchObject({ code: "domain_rule_violation", status: 422, url: "/x" });
  });

  it("keeps the known fields and re-keys only the others", () => {
    const error = apiError("unprocessable", [
      { field: "weekly_periods", issue: "Too few." },
      { field: "academic_session_id", issue: "Session is closed." },
    ]);

    const folded = foldUnknownFieldErrors(error, ["weekly_periods"]);

    expect((folded as ApiError).fieldErrors()).toEqual({
      weekly_periods: "Too few.",
      non_field: "Session is closed.",
    });
  });

  it("returns the same error when nothing is unknown, and anything that isn't an ApiError", () => {
    const known = apiError("unprocessable", [
      { field: "weekly_periods", issue: "Too few." },
      { field: "non_field", issue: "Already mapped." },
    ]);
    const plain = new Error("boom");

    expect(foldUnknownFieldErrors(known, ["weekly_periods"])).toBe(known);
    expect(foldUnknownFieldErrors(plain)).toBe(plain);
    expect(foldUnknownFieldErrors("nope")).toBe("nope");
  });

  it("lets applyServerFieldErrors' fallback show the folded reason", () => {
    const form = { setError: jest.fn(), clearErrors: jest.fn() };
    const setFormError = jest.fn();
    const error = apiError("domain_rule_violation", [
      { field: "academic_session_id", issue: "Session is closed." },
    ]);

    applyServerFieldErrors({
      error: foldUnknownFieldErrors(error, ["weekly_periods"]),
      form,
      knownFields: ["weekly_periods"],
      tErrors,
      fallback: "fallback",
      setFormError,
    });

    expect(form.setError).not.toHaveBeenCalled();
    expect(setFormError).toHaveBeenLastCalledWith("Session is closed.");
  });
});
