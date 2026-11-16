import { ApiError } from "@/services";

import { slugify } from "../content-fields";
import { localiseContentError } from "../content-errors";
import { rekeyRichTextErrors } from "../use-content-form-submit";
import { documentError, violation } from "./content-fixtures";

const translate = (reason: string) =>
  reason === "slug_taken" ? "Another item already uses this address." : undefined;

describe("localiseContentError", () => {
  it("replaces the known reason's detail with the translated sentence", () => {
    const error = localiseContentError(
      violation("slug", "slug_taken", "another item already uses this address."),
      translate,
    );

    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).fieldErrors()).toEqual({
      slug: "Another item already uses this address.",
    });
  });

  it("keeps an unknown reason, an error with none and a non-API failure as they came", () => {
    const unknown = violation("items", "too_many_items", "at most 50 items per menu.");
    const plain = documentError("blocks.0.text", "'' is too short");
    const failure = new Error("network");

    expect(localiseContentError(unknown, translate)).toBe(unknown);
    expect(localiseContentError(plain, translate)).toBe(plain);
    expect(localiseContentError(failure, translate)).toBe(failure);
  });
});

describe("rekeyRichTextErrors", () => {
  const doc = { blocks: [{ type: "paragraph", text: "" }] };

  it("moves a block's error under its input, and names it", () => {
    const { error, fields } = rekeyRichTextErrors(
      documentError("blocks.0.text", "'' is too short"),
      "body",
      doc,
    );

    expect((error as ApiError).fieldErrors()).toEqual({ "body.blocks.0.text": "'' is too short" });
    expect(fields).toEqual(["body.blocks.0.text"]);
  });

  it("lands an index past the end on the editor itself", () => {
    const { error } = rekeyRichTextErrors(documentError("blocks.4.text", "bad"), "body", doc);

    expect((error as ApiError).fieldErrors()).toEqual({ body: "bad" });
  });

  it("leaves a field outside the document alone", () => {
    const original = violation("slug", "slug_taken", "another item already uses this address.");

    expect(rekeyRichTextErrors(original, "body", doc).error).toBe(original);
  });
});

describe("slugify", () => {
  it.each([
    ["Sports Day: Results!", "sports-day-results"],
    ["  Café opening  ", "cafe-opening"],
    ["!!! ???", ""],
    ["2026 -- Prize   day", "2026-prize-day"],
  ])("%s -> %s", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });
});
