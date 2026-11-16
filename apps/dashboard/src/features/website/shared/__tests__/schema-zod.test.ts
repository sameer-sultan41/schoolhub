import type { JsonSchema } from "@/services";

import { isSafeUrl } from "../schema-model";
import { schemaToZod, type SchemaMessages } from "../schema-zod";

const MESSAGES: SchemaMessages = {
  required: "required",
  tooLong: (max) => `tooLong:${max}`,
  tooShort: (min) => `tooShort:${min}`,
  notANumber: "notANumber",
  notAWholeNumber: "notAWholeNumber",
  tooSmall: (min) => `tooSmall:${min}`,
  tooLarge: (max) => `tooLarge:${max}`,
  unsafeUrl: "unsafeUrl",
  notAnOption: "notAnOption",
  imageRequired: "imageRequired",
};

const SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string", minLength: 3, maxLength: 5 },
    count: { type: "integer", minimum: 1, maximum: 9 },
    ratio: { type: "number" },
    form: { type: "string", enum: ["contact", "admission_enquiry"] },
    link: { type: "string", format: "safe-url" },
    photo: { type: "string", "x-widget": "image" },
    meta: { type: "object", properties: { note: { type: "string", maxLength: 2 } } },
  },
  required: ["title", "count", "form", "photo"],
} as JsonSchema;

const VALID = {
  title: "Hello",
  count: "3",
  ratio: "",
  form: "contact",
  link: "",
  photo: "f1",
  meta: { note: "" },
};

function issues(values: Record<string, unknown>): Record<string, string> {
  const result = schemaToZod(SCHEMA, MESSAGES).safeParse(values);
  if (result.success) return {};
  return Object.fromEntries(
    result.error.issues.map((issue) => [issue.path.join("."), issue.message]),
  );
}

describe("schemaToZod", () => {
  it("accepts valid values, empty optional ones included", () => {
    expect(issues(VALID)).toEqual({});
  });

  it("checks lengths, numbers, options, links, images and nested objects", () => {
    expect(
      issues({
        title: "Hi",
        count: "1.5",
        ratio: "abc",
        form: "other",
        link: "//evil.test",
        photo: "",
        meta: { note: "too long" },
      }),
    ).toEqual({
      title: "tooShort:3",
      count: "notAWholeNumber",
      ratio: "notANumber",
      form: "notAnOption",
      link: "unsafeUrl",
      photo: "imageRequired",
      "meta.note": "tooLong:2",
    });
  });

  it("refuses empty required values and out-of-range numbers", () => {
    expect(issues({ ...VALID, title: "", count: "", form: "" })).toEqual({
      title: "required",
      count: "required",
      form: "required",
    });
    expect(issues({ ...VALID, title: "Too long", count: "0" })).toMatchObject({
      title: "tooLong:5",
      count: "tooSmall:1",
    });
    expect(issues({ ...VALID, count: "10" })).toEqual({ count: "tooLarge:9" });
  });
});

describe("isSafeUrl", () => {
  it.each([
    ["https://school.example/apply", true],
    ["/admissions", true],
    ["http://school.example", false],
    ["javascript:alert(1)", false],
    ["data:text/html,hi", false],
    ["//evil.test", false],
    ["/\\evil.test", false],
    ["https://school .example", false],
    ["https:\\\\evil.test", false],
    ["", false],
  ])("%s is %s", (value, expected) => {
    expect(isSafeUrl(value)).toBe(expected);
  });
});
