import type { ThemeRecord } from "../themes-type";
import { asJsonSchema, themeSectionTypes } from "../themes-helper";

function theme(sectionTypes: unknown): ThemeRecord {
  return {
    id: "t1",
    code: "default",
    name: "Default",
    version: "1.0.0",
    description: "",
    config_schema: {},
    section_types: sectionTypes,
  };
}

describe("themes-helper", () => {
  it("narrows section types to label and schema, skipping malformed entries", () => {
    const types = themeSectionTypes(
      theme({
        hero: { label: "Hero", schema: { type: "object" } },
        faq: { schema: { type: "object" } },
        broken: { label: "Broken", schema: "nope" },
        worse: 3,
      }),
    );

    expect(types).toEqual({
      hero: { label: "Hero", schema: { type: "object" } },
      faq: { label: "faq", schema: { type: "object" } },
    });
  });

  it("treats a non-object as no section types and no schema", () => {
    expect(themeSectionTypes(theme(null))).toEqual({});
    expect(asJsonSchema([1, 2])).toEqual({});
  });
});
