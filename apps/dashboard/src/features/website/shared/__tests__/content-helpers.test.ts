import type { ApiError } from "@/services";

import { slugify } from "../content-fields";
import { rekeyRichTextErrors } from "../use-content-form-submit";
import { documentError, violation } from "./content-fixtures";

jest.mock("@/services", () =>
  jest
    .requireActual<{
      servicesMock: (domains: Record<string, readonly string[]>) => unknown;
    }>("@/test-fixtures/services-mock")
    .servicesMock({}),
);

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
    ["résumé", "resume"],
    ["Naïve Façade", "naive-facade"],
    ["!!! ???", ""],
    ["2026 -- Prize   day", "2026-prize-day"],
  ])("%s -> %s", (title, slug) => {
    expect(slugify(title)).toBe(slug);
  });
});
