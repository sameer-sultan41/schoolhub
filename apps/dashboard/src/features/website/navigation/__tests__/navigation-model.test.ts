import { ApiError } from "@/services";

import { violation } from "@/features/website/shared/__tests__/content-fixtures";
import {
  canNest,
  countLinks,
  localiseMenuError,
  menuFields,
  menuFormSchema,
  nestItem,
  toMenuFormValues,
  toNavItems,
  unnestItem,
  type MenuMessages,
  type NavItemValues,
} from "../navigation-model";

jest.mock("@/services", () =>
  jest
    .requireActual<{
      servicesMock: (domains: Record<string, readonly string[]>) => unknown;
    }>("@/test-fixtures/services-mock")
    .servicesMock({}),
);

const PAGE_ID = "3c9e1a2b-4d5f-4a6b-8c7d-9e0f1a2b3c4d";

const MESSAGES: MenuMessages = {
  required: "required",
  tooLong: (max) => `max ${String(max)}`,
  unsafeUrl: "unsafe",
  choosePage: "choose a page",
};

function fieldErrorsOf(error: unknown) {
  if (!(error instanceof ApiError)) throw new Error("expected an ApiError");
  return error.fieldErrors();
}

function link(label: string, children: NavItemValues["children"] = []): NavItemValues {
  return { label, target_type: "news_index", target: "", children };
}

describe("navigation-model", () => {
  it("round-trips a stored menu, sending an index's target as null and labels trimmed", () => {
    const values = toMenuFormValues([
      {
        label: "About",
        target_type: "page",
        target: PAGE_ID,
        children: [{ label: " Staff ", target_type: "url", target: "/staff", children: [] }],
      },
      { label: "News", target_type: "news_index", target: null },
    ]);

    expect(values.items[1]).toEqual({
      label: "News",
      target_type: "news_index",
      target: "",
      children: [],
    });
    expect(toNavItems(values)).toEqual([
      {
        label: "About",
        target_type: "page",
        target: PAGE_ID,
        children: [{ label: "Staff", target_type: "url", target: "/staff", children: [] }],
      },
      { label: "News", target_type: "news_index", target: null, children: [] },
    ]);
  });

  it("counts every link, sub-links included", () => {
    expect(countLinks([link("A", [link("B"), link("C")]), link("D")])).toBe(4);
  });

  it("nests only a link below another that holds no sub-links of its own", () => {
    const items = [link("A"), link("B", [link("B1")]), link("C")];

    expect(canNest(items, 0)).toBe(false);
    expect(canNest(items, 1)).toBe(false);
    expect(canNest(items, 2)).toBe(true);
    expect(
      nestItem(items, 2).map((item) => [item.label, item.children.map((c) => c.label)]),
    ).toEqual([
      ["A", []],
      ["B", ["B1", "C"]],
    ]);
    // A refused nest changes nothing.
    expect(nestItem(items, 1)).toEqual(items);
  });

  it("moves a sub-link out to just after its parent", () => {
    const items = [link("A", [link("A1"), link("A2")]), link("B")];

    expect(unnestItem(items, 0, 0).map((item) => item.label)).toEqual(["A", "A1", "B"]);
    expect(unnestItem(items, 0, 0)[0]?.children.map((child) => child.label)).toEqual(["A2"]);
    expect(unnestItem(items, 5, 0)).toEqual(items);
  });

  it("checks labels and targets as the server does", () => {
    const schema = menuFormSchema(MESSAGES);
    const result = schema.safeParse({
      items: [
        { label: " ", target_type: "page", target: "", children: [] },
        {
          label: "x".repeat(61),
          target_type: "news_index",
          target: "",
          children: [{ label: "Bad", target_type: "url", target: "javascript:alert(1)" }],
        },
      ],
    });

    expect(result.success).toBe(false);
    const issues = result.error?.issues.map((issue) => [issue.path.join("."), issue.message]);
    expect(issues).toEqual(
      expect.arrayContaining([
        ["items.0.label", "required"],
        ["items.0.target", "choose a page"],
        ["items.1.label", "max 60"],
        ["items.1.children.0.target", "unsafe"],
      ]),
    );
  });

  it("names every input a server error may land on", () => {
    expect(menuFields({ items: [link("A", [link("A1")])] })).toEqual([
      "items.0.label",
      "items.0.target",
      "items.0.children.0.label",
      "items.0.children.0.target",
    ]);
  });

  it("words invalid_target by the type of the link it names", () => {
    const values = { items: [{ ...link("A"), target_type: "page" as const, target: PAGE_ID }] };
    const messageFor = jest.fn((reason: string, type: string | undefined) =>
      reason === "invalid_target" ? `target for ${type ?? "nothing"}` : undefined,
    );

    const localised = localiseMenuError(
      violation("items.0.target", "invalid_target", "choose a published page."),
      values,
      messageFor,
    );

    expect(fieldErrorsOf(localised)).toEqual({ "items.0.target": "target for page" });
    // A reason with no wording of its own keeps the server's issue.
    const kept = localiseMenuError(
      violation("items", "too_many_items", "at most 50 items per menu."),
      values,
      messageFor,
    );
    expect(fieldErrorsOf(kept)).toEqual({
      items: "too_many_items: at most 50 items per menu.",
    });
  });
});
