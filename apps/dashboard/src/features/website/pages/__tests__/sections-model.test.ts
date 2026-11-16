import { set } from "react-hook-form";

import { themeSectionTypes } from "@/services/modules/website/themes/themes-helper";

import {
  mapSectionErrors,
  sectionIndexesWithErrors,
  toSectionsFormValues,
  toSectionsPayload,
} from "../sections-model";
import { FAQ_ID, HERO_ID, refusal, sectionRecord, THEME } from "./pages-test-support";

jest.mock("@/services", () =>
  jest
    .requireActual<{ pagesServicesMock: () => unknown }>("./pages-services-mock")
    .pagesServicesMock(),
);

const types = themeSectionTypes(THEME);
const identity = (issue: string) => issue;

const saved = [
  sectionRecord({ content: { heading: "Welcome", image_file_id: "" } }),
  sectionRecord({
    id: FAQ_ID,
    section_type: "faq",
    position: 1,
    content: { items: [{ question: "When?", answer: "In March." }] },
  }),
  // A type the active theme no longer declares: kept and sent back untouched.
  sectionRecord({
    id: "0c4b2f6d-7e8a-4b9c-8d1e-2f3a4b5c6d7e",
    section_type: "gallery",
    position: 2,
    content: { heading: "Photos", layout: "masonry" },
    is_visible: false,
  }),
];

describe("sections model", () => {
  it("round-trips the saved sections, omitting an empty image and keeping an unknown type", () => {
    const values = toSectionsFormValues(saved, types);

    expect(values.sections.map((section) => section.key)).toEqual([
      HERO_ID,
      FAQ_ID,
      "0c4b2f6d-7e8a-4b9c-8d1e-2f3a4b5c6d7e",
    ]);
    expect(toSectionsPayload(values, types)).toEqual([
      { id: HERO_ID, section_type: "hero", is_visible: true, content: { heading: "Welcome" } },
      {
        id: FAQ_ID,
        section_type: "faq",
        is_visible: true,
        content: { items: [{ question: "When?", answer: "In March." }] },
      },
      {
        id: "0c4b2f6d-7e8a-4b9c-8d1e-2f3a4b5c6d7e",
        section_type: "gallery",
        is_visible: false,
        content: { heading: "Photos", layout: "masonry" },
      },
    ]);
  });

  it("maps each 422 detail to an input, a section or the page", () => {
    const values = toSectionsFormValues(saved, types);
    const mapping = mapSectionErrors(
      refusal([
        { field: "sections.1.items.0.answer", issue: "Too short." },
        { field: "sections.1.content.heading", issue: "Too long." },
        { field: "sections.0", issue: "Not an object." },
        { field: "sections.2.section_type", issue: "Unknown section type 'gallery'." },
        { field: "sections.1.items.5.answer", issue: "Stale index." },
        { field: "sections.9.heading", issue: "No such section." },
        { field: "file_id", issue: "This file is not available." },
      ]),
      values,
      types,
      identity,
    );

    expect(mapping.fields).toEqual([
      { path: "sections.1.content.items.0.answer", message: "Too short." },
      { path: "sections.1.content.heading", message: "Too long." },
      // An index past the end lands on the list itself.
      { path: "sections.1.content.items", message: "Stale index." },
    ]);
    expect(mapping.sections).toEqual({
      [HERO_ID]: "Not an object.",
      "0c4b2f6d-7e8a-4b9c-8d1e-2f3a4b5c6d7e": "Unknown section type 'gallery'.",
    });
    expect(mapping.page).toEqual(["No such section.", "This file is not available."]);
  });

  it("reads which sections hold a client-side error", () => {
    expect(sectionIndexesWithErrors({})).toEqual([]);
    const errors = {};
    set(errors, "sections.1.content.heading", { type: "custom", message: "Too long." });
    expect(sectionIndexesWithErrors(errors)).toEqual([1]);
  });
});
